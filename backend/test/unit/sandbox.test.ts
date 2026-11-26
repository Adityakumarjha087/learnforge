import { describe, expect, it, vi } from "vitest";
import { SandboxService } from "../../src/sandbox";
import { PistonRunner } from "../../src/sandbox/piston";
import { QuickJsRunner } from "../../src/sandbox/quickjs";
import { finalize, jsonEqual, type CodeRunner } from "../../src/sandbox/types";

const tests = [
  { args: "[[1,2,3]]", expected: "6" },
  { args: "[[]]", expected: "0" },
];

describe("QuickJS WASM sandbox", () => {
  const runner = new QuickJsRunner(500);

  it("passes a correct solution and captures console output", async () => {
    const res = await runner.run("javascript", "function sumArray(n){ console.log('len', n.length); return n.reduce((a,b)=>a+b,0) }", "sumArray", tests);
    expect(res.passed).toBe(true);
    expect(res.results.every((r) => r.passed)).toBe(true);
    expect(res.stdout).toContain("len 3");
    expect(res.runner).toBe("quickjs-wasm");
  });

  it("reports wrong answers, missing returns and runtime errors per test", async () => {
    const wrong = await runner.run("js", "function sumArray(n){ return n.length }", "sumArray", tests);
    expect(wrong.passed).toBe(false);
    expect(wrong.results[0]).toMatchObject({ passed: false, actual: "3" });
    const undef = await runner.run("js", "function sumArray(n){ }", "sumArray", tests);
    expect(undef.results[0]!.actual).toBe("undefined");
    const thrown = await runner.run("js", "function sumArray(){ throw new Error('boom') }", "sumArray", tests);
    expect(thrown.results[0]!.error).toBe("boom");
    const missing = await runner.run("js", "function other(){}", "sumArray", tests);
    expect(missing.results[0]!.error).toMatch(/not defined/);
  });

  it("reports syntax errors", async () => {
    const res = await runner.run("js", "function sumArray( {", "sumArray", tests);
    expect(res.passed).toBe(false);
    expect(res.results[0]!.error).toMatch(/SyntaxError/);
  });

  it("interrupts infinite loops", async () => {
    const res = await runner.run("js", "function sumArray(){ while(true){} }", "sumArray", tests);
    expect(res.passed).toBe(false);
    expect(res.results[0]!.error).toMatch(/timed out|interrupted/i);
  });

  it("has no access to Node.js host APIs and cannot tamper with JSON", async () => {
    const probe = await runner.run("js", "function sumArray(){ return [typeof process, typeof require, typeof fetch] }", "sumArray", [{ args: "[]", expected: '["undefined","undefined","undefined"]' }]);
    expect(probe.passed).toBe(true);
    const tamper = await runner.run("js", "JSON.stringify = () => '6'; function sumArray(){ return 1 }", "sumArray", [{ args: "[[1]]", expected: "6" }]);
    expect(tamper.passed).toBe(false);
  });

  it("rejects invalid entrypoints and only supports JavaScript", async () => {
    await expect(runner.run("js", "", "bad name", tests)).rejects.toThrow();
    expect(runner.supports("python")).toBe(false);
  });
});

describe("Piston runner (mocked HTTP)", () => {
  it("parses the harness marker from stdout", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.language).toBe("python");
      expect(body.files[0].content).toContain("__LEARNFORGE_RESULTS__");
      return new Response(JSON.stringify({ run: { stdout: 'hello\n__LEARNFORGE_RESULTS__[{"actual":"6","error":null},{"actual":"0","error":null}]\n', stderr: "" } }));
    });
    const r = await new PistonRunner("http://piston:2000/", 1000, fetchImpl as unknown as typeof fetch).run("python", "def sumArray(n): return sum(n)", "sumArray", tests);
    expect(r.passed).toBe(true);
    expect(r.stdout).toBe("hello");
  });

  it("maps timeouts and HTTP failures", async () => {
    const killed = vi.fn(async () => new Response(JSON.stringify({ run: { stdout: "", stderr: "", signal: "SIGKILL" } })));
    const r = await new PistonRunner("http://p", 1000, killed as unknown as typeof fetch).run("javascript", "x", "f", tests);
    expect(r.results[0]!.error).toMatch(/timed out/);
    const down = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(new PistonRunner("http://p", 1000, down as unknown as typeof fetch).run("js", "x", "f", tests)).rejects.toThrow(/503/);
  });
});

describe("SandboxService", () => {
  const ok: CodeRunner = { name: "ok", supports: () => true, run: async () => ({ passed: true, results: [], stdout: "", durationMs: 1, runner: "ok" }) };
  const broken: CodeRunner = { name: "broken", supports: () => true, run: async () => { throw new Error("down"); } };

  it("falls back when the primary runner fails", async () => {
    expect((await new SandboxService(broken, ok).run("javascript", "x", "f", [])).runner).toBe("ok");
    await expect(new SandboxService(broken, null).run("javascript", "x", "f", [])).rejects.toThrow("down");
  });

  it("rejects unsupported languages and oversize code", async () => {
    const jsOnly = new QuickJsRunner();
    await expect(new SandboxService(jsOnly, null).run("ruby", "x", "f", [])).rejects.toThrow(/not supported/);
    await expect(new SandboxService(ok, null).run("js", "x".repeat(20_001), "f", [])).rejects.toThrow(/too long/);
  });
});

describe("result comparison", () => {
  it("compares JSON structurally", () => {
    expect(jsonEqual('{"b":1,"a":[1,2]}', '{"a":[1,2],"b":1}')).toBe(true);
    expect(jsonEqual("0.30000000000000004", "0.3")).toBe(true);
    expect(jsonEqual(null, "1")).toBe(false);
    expect(jsonEqual("not json", "not json")).toBe(true);
    expect(finalize([], [{ args: "[]", expected: "1" }])[0]!.error).toMatch(/did not run/);
  });
});
