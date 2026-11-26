import { describe, expect, it, vi } from "vitest";
import { authorizeUrl, enabledProviders, exchangeCode } from "../../src/auth/oauth";
import { hasRole, signAccessToken, signSocketToken, verifyAccessToken, verifySocketToken } from "../../src/auth/tokens";
import { mapStripeEvent } from "../../src/billing/stripe";
import { loadEnv, setEnvForTests } from "../../src/config/env";
import { safeEqual, sha256 } from "../../src/lib/crypto";
import { badRequest, forbidden, notFound } from "../../src/lib/errors";
import { createRng, hashString, pick, shuffle } from "../../src/lib/rng";
import { keywords, overlap, slugify, splitSentences, titleCase, truncate } from "../../src/lib/text";
import { chunkText } from "../../src/rag/chunker";
import { filterMarkers, stripMarkers } from "../../src/services/tutor";
import type Stripe from "stripe";

const user = { id: "u1", email: "a@b.c", name: "A", role: "INSTRUCTOR" as const };

describe("tokens", () => {
  it("round-trips access tokens and enforces audience", async () => {
    const token = await signAccessToken(user);
    expect(await verifyAccessToken(token)).toEqual(user);
    expect(await verifySocketToken(token)).toBeNull();
    const socket = await signSocketToken(user);
    expect(await verifySocketToken(socket)).toEqual(user);
    expect(await verifyAccessToken("garbage")).toBeNull();
  });

  it("rejects expired tokens and ranks roles", async () => {
    const t = await signAccessToken(user, 1);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await verifyAccessToken(t)).toBeNull();
    expect(hasRole({ role: "ADMIN" }, "INSTRUCTOR")).toBe(true);
    expect(hasRole({ role: "LEARNER" }, "INSTRUCTOR")).toBe(false);
  });
});

describe("env", () => {
  it("parses and validates configuration", () => {
    expect(loadEnv({ DATABASE_URL: "postgres://x", COOKIE_SECURE: "true" }).COOKIE_SECURE).toBe(true);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: "x", NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
  });
});

describe("oauth", () => {
  it("is disabled without credentials", () => {
    expect(enabledProviders()).toEqual([]);
    expect(() => authorizeUrl("github", "s")).toThrow(/not configured/);
  });

  it("builds authorize URLs and exchanges codes for GitHub and Google profiles", async () => {
    setEnvForTests({ GITHUB_CLIENT_ID: "gh", GITHUB_CLIENT_SECRET: "sec", GOOGLE_CLIENT_ID: "go", GOOGLE_CLIENT_SECRET: "sec" });
    try {
      expect(authorizeUrl("github", "state123")).toContain("state=state123");
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.includes("access_token") || url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "tok" });
        if (url.endsWith("/user")) return Response.json({ id: 7, login: "octo", avatar_url: "a.png" });
        if (url.endsWith("/user/emails")) return Response.json([{ email: "octo@gh.dev", primary: true, verified: true }]);
        return Response.json({ sub: "g-1", email: "g@g.dev", email_verified: true, name: "G" });
      });
      expect(await exchangeCode("github", "code", fetchImpl as unknown as typeof fetch)).toEqual({ id: "7", email: "octo@gh.dev", name: "octo", image: "a.png" });
      expect((await exchangeCode("google", "code", fetchImpl as unknown as typeof fetch)).email).toBe("g@g.dev");
      const failing = vi.fn(async () => Response.json({ error: "bad_verification_code" }, { status: 400 }));
      await expect(exchangeCode("github", "code", failing as unknown as typeof fetch)).rejects.toThrow(/bad_verification_code/);
    } finally {
      setEnvForTests({ GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" });
    }
  });
});

describe("stripe event mapping", () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ id: "evt_1", type, data: { object } }) as unknown as Stripe.Event;

  it("maps the subscription lifecycle", () => {
    expect(mapStripeEvent(ev("checkout.session.completed", { client_reference_id: "u1", customer: "cus_1", subscription: "sub_1" }))).toMatchObject({ userId: "u1", customerId: "cus_1", subscriptionId: "sub_1", signal: { type: "checkout.completed" } });
    const upd = mapStripeEvent(ev("customer.subscription.updated", { id: "sub_1", customer: { id: "cus_1" }, status: "past_due", cancel_at_period_end: true, items: { data: [{ current_period_end: 1_900_000_000 }] } }));
    expect(upd?.signal).toMatchObject({ type: "subscription.updated", status: "PAST_DUE", cancelAtPeriodEnd: true });
    expect(mapStripeEvent(ev("customer.subscription.deleted", { id: "sub_1", customer: "cus_1" }))?.signal.type).toBe("subscription.deleted");
    expect(mapStripeEvent(ev("invoice.paid", { customer: "cus_1", lines: { data: [{ period: { end: 1_900_000_000 } }] } }))?.signal).toMatchObject({ type: "invoice.paid" });
    expect(mapStripeEvent(ev("invoice.payment_failed", { customer: "cus_1" }))?.signal.type).toBe("invoice.payment_failed");
    expect(mapStripeEvent(ev("charge.refunded", {}))).toBeNull();
  });
});

describe("text, rng and crypto utilities", () => {
  it("extracts sentences and keywords from markdown", () => {
    const md = "## Title\n\nThe **map** method creates a new array from an array.\n\n```js\nconst x = 1;\n```\n\nUse $x^2$ here in this sentence please.";
    expect(splitSentences(md)).toEqual(["The map method creates a new array from an array."]);
    expect(keywords(md, 2)).toContain("array");
    expect(titleCase("the art of war")).toBe("The Art of War");
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("!!!")).toBe("course");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(overlap("dot product vectors", "vectors dot product")).toBe(1);
    expect(overlap("", "x")).toBe(0);
  });

  it("seeded RNG is deterministic", () => {
    const a = createRng("seed");
    const b = createRng("seed");
    expect([a(), a()]).toEqual([b(), b()]);
    expect(shuffle([1, 2, 3, 4], createRng(1)).sort()).toEqual([1, 2, 3, 4]);
    expect(() => pick([], createRng(1))).toThrow();
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("hashes and compares safely", () => {
    expect(sha256("x")).toHaveLength(64);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(notFound("Course").status).toBe(404);
    expect(forbidden().status).toBe(403);
    expect(badRequest("x").code).toBe("BAD_REQUEST");
  });
});

describe("chunker", () => {
  it("splits on paragraphs with overlap and handles long paragraphs", () => {
    expect(chunkText("")).toEqual([]);
    const paras = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(40)).join("\n\n");
    const chunks = chunkText(paras, 500, 80);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(600);
    const long = chunkText("token ".repeat(1000), 300, 50);
    expect(long.length).toBeGreaterThan(10);
  });
});

describe("tutor marker filtering", () => {
  async function collect(chunks: string[]) {
    async function* src() {
      for (const c of chunks) yield c;
    }
    let out = "";
    for await (const c of filterMarkers(src())) out += c;
    return out;
  }

  it("removes hidden markers even across chunk boundaries", async () => {
    expect(await collect(["Hello ", "world <!--ke", "y:array--> done"])).toBe("Hello world  done");
    expect(await collect(["no markers at all"])).toBe("no markers at all");
    expect(await collect(["tail <!--unterminated"])).toBe("tail ");
    expect(stripMarkers("a <!--key:x--> b")).toBe("a  b");
  });
});
