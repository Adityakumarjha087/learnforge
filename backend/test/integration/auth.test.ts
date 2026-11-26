import { beforeAll, describe, expect, it } from "vitest";
import { cookieHeader, getApp, prisma, resetDb } from "../helpers";

describe("auth REST API", () => {
  beforeAll(resetDb);

  it("registers, reads the session and logs in", async () => {
    const app = await getApp();
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "New@Test.dev", password: "supersecret", name: "Newbie", role: "INSTRUCTOR" } });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().user).toMatchObject({ email: "new@test.dev", role: "INSTRUCTOR" });
    const cookies = cookieHeader(reg.headers["set-cookie"]);
    expect(cookies).toContain("lf_access=");
    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookies } });
    expect(session.json().user.email).toBe("new@test.dev");
    const dup = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "new@test.dev", password: "supersecret", name: "X" } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "new@test.dev", password: "wrong-password" } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "new@test.dev", password: "supersecret" } });
    expect(ok.statusCode).toBe(200);
    const invalid = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "nope", password: "1" } });
    expect(invalid.statusCode).toBe(400);
  });

  it("rotates refresh tokens and detects reuse", async () => {
    const app = await getApp();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "new@test.dev", password: "supersecret" } });
    const first = cookieHeader(login.headers["set-cookie"]);
    const r1 = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: first } });
    expect(r1.statusCode).toBe(200);
    const second = cookieHeader(r1.headers["set-cookie"]);
    expect(second).not.toBe(first);
    // Replaying the first (rotated) token revokes the family, so the second token dies too.
    const replay = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: first } });
    expect(replay.statusCode).toBe(401);
    const afterTheft = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: second } });
    expect(afterTheft.statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/refresh" })).statusCode).toBe(401);
  });

  it("supports body refresh tokens for API clients and logout", async () => {
    const app = await getApp();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "new@test.dev", password: "supersecret" } });
    const rt = cookieHeader(login.headers["set-cookie"]).match(/lf_refresh=([^;]+)/)![1]!;
    const r = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken: decodeURIComponent(rt) } });
    expect(r.json().refreshToken).toBeTruthy();
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: cookieHeader(r.headers["set-cookie"]) } });
    expect(out.json()).toEqual({ ok: true });
    const reuse = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: cookieHeader(r.headers["set-cookie"]) } });
    expect(reuse.statusCode).toBe(401);
    expect(await prisma.refreshToken.count({ where: { user: { email: "new@test.dev" } } })).toBeGreaterThan(2);
  });

  it("magic link flow via the dev mailbox creates a user and is single-use", async () => {
    const app = await getApp();
    const req = await app.inject({ method: "POST", url: "/api/auth/magic-link", payload: { email: "magic@test.dev" } });
    expect(req.json()).toMatchObject({ sent: true, devMailbox: true });
    const box = await app.inject({ method: "GET", url: "/api/auth/dev/mailbox?email=magic@test.dev" });
    const link: string = box.json().messages[0].link;
    const token = new URL(link).searchParams.get("token")!;
    const verify = await app.inject({ method: "POST", url: "/api/auth/magic-link/verify", payload: { token } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().user.email).toBe("magic@test.dev");
    const again = await app.inject({ method: "POST", url: "/api/auth/magic-link/verify", payload: { token } });
    expect(again.statusCode).toBe(401);
  });

  it("dev login, providers and OAuth guards", async () => {
    const app = await getApp();
    const dev = await app.inject({ method: "POST", url: "/api/auth/dev/login", payload: { email: "new@test.dev" } });
    expect(dev.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/dev/login", payload: { email: "ghost@test.dev" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/auth/providers" })).json()).toMatchObject({ oauth: [], magicLink: true });
    expect((await app.inject({ method: "GET", url: "/api/auth/oauth/github" })).statusCode).toBe(404);
    const cb = await app.inject({ method: "GET", url: "/api/auth/oauth/github/callback?code=x&state=y" });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain("error=oauth_state");
  });
});
