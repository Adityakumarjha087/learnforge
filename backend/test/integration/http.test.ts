import { beforeAll, describe, expect, it } from "vitest";
import { signAccessToken } from "../../src/auth/tokens";
import { createUser, getApp, resetDb } from "../helpers";

function multipart(filename: string, type: string, content: string | Buffer) {
  const boundary = "----lfboundary";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head), Buffer.isBuffer(content) ? content : Buffer.from(content), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("HTTP surface", () => {
  beforeAll(resetDb);

  it("health, docs and not-found handling", async () => {
    const app = await getApp();
    const h = await app.inject({ method: "GET", url: "/health" });
    expect(h.json()).toMatchObject({ status: "ok", db: "up", redis: "disabled", llm: "fake" });
    const doc = (await app.inject({ method: "GET", url: "/api/docs/json" })).json();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/api/trpc/course.generate", "/api/trpc/quiz.submit", "/api/auth/login"]));
    expect(doc.paths["/api/trpc/course.get"].get.parameters[0].name).toBe("input");
    expect((await app.inject({ method: "GET", url: "/nope" })).statusCode).toBe(404);
  });

  it("uploads notes for grounded generation and validates files", async () => {
    const app = await getApp();
    const user = await createUser();
    const auth = { authorization: `Bearer ${await signAccessToken(user)}` };
    const notes = "Mitochondria are the powerhouse of the cell and produce ATP through cellular respiration. ".repeat(6);
    const ok = multipart("bio.md", "text/markdown", notes);
    const res = await app.inject({ method: "POST", url: "/api/uploads", payload: ok.payload, headers: { ...ok.headers, ...auth } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ filename: "bio.md" });
    const tooShort = multipart("x.txt", "text/plain", "short");
    expect((await app.inject({ method: "POST", url: "/api/uploads", payload: tooShort.payload, headers: { ...tooShort.headers, ...auth } })).statusCode).toBe(400);
    const fakePdf = multipart("x.pdf", "application/pdf", "not a pdf at all");
    expect((await app.inject({ method: "POST", url: "/api/uploads", payload: fakePdf.payload, headers: { ...fakePdf.headers, ...auth } })).statusCode).toBe(400);
    const exe = multipart("x.exe", "application/octet-stream", Buffer.alloc(300, 1));
    expect((await app.inject({ method: "POST", url: "/api/uploads", payload: exe.payload, headers: { ...exe.headers, ...auth } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/uploads", payload: ok.payload, headers: ok.headers })).statusCode).toBe(401);
  });

  it("rejects unauthenticated tRPC calls with 401", async () => {
    const app = await getApp();
    const r = await app.inject({ method: "GET", url: "/api/trpc/me.get" });
    expect(r.statusCode).toBe(401);
    const cfg = await app.inject({ method: "GET", url: "/api/trpc/system.config" });
    expect(cfg.json().result.data.json).toMatchObject({ llmProvider: "fake", billingMode: "mock" });
  });
});
