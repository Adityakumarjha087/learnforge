import { finalize, type CodeRunner, type RunResult, type TestCase } from "./types";

const MARKER = "__LEARNFORGE_RESULTS__";

function jsHarness(code: string, entrypoint: string, tests: TestCase[]): string {
  return `${code}
;(() => {
  const tests = ${JSON.stringify(tests)};
  const out = [];
  for (const t of tests) {
    try { const a = ${entrypoint}(...JSON.parse(t.args)); out.push({ actual: a === undefined ? "undefined" : JSON.stringify(a), error: null }); }
    catch (e) { out.push({ actual: null, error: String((e && e.message) || e) }); }
  }
  console.log("${MARKER}" + JSON.stringify(out));
})();`;
}

function pyHarness(code: string, entrypoint: string, tests: TestCase[]): string {
  return `${code}

import json as __json
__tests = __json.loads(${JSON.stringify(JSON.stringify(tests))})
__out = []
for __t in __tests:
    try:
        __a = ${entrypoint}(*__json.loads(__t["args"]))
        __out.append({"actual": __json.dumps(__a), "error": None})
    except Exception as __e:
        __out.append({"actual": None, "error": f"{type(__e).__name__}: {__e}"})
print("${MARKER}" + __json.dumps(__out))
`;
}

/** Piston (https://github.com/engineer-man/piston) - containerised multi-language execution, enabled via compose profile. */
export class PistonRunner implements CodeRunner {
  readonly name = "piston";
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  supports(language: string): boolean {
    return ["javascript", "js", "python", "py"].includes(language.toLowerCase());
  }

  async run(language: string, code: string, entrypoint: string, tests: TestCase[]): Promise<RunResult> {
    const started = performance.now();
    const isPy = language.toLowerCase().startsWith("py");
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/v2/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language: isPy ? "python" : "javascript",
        version: "*",
        files: [{ name: isPy ? "main.py" : "main.js", content: isPy ? pyHarness(code, entrypoint, tests) : jsHarness(code, entrypoint, tests) }],
        run_timeout: this.timeoutMs,
        run_memory_limit: 64 * 1024 * 1024,
      }),
    });
    if (!res.ok) throw new Error(`Piston returned ${res.status}`);
    const body = (await res.json()) as { run?: { stdout?: string; stderr?: string; signal?: string | null } };
    const stdout = body.run?.stdout ?? "";
    const line = stdout.split("\n").find((l) => l.startsWith(MARKER));
    const error = body.run?.signal === "SIGKILL" ? "Execution timed out" : (body.run?.stderr?.trim().split("\n").pop() ?? "No output");
    const raw = line ? (JSON.parse(line.slice(MARKER.length)) as { actual: string | null; error: string | null }[]) : tests.map(() => ({ actual: null, error }));
    const results = finalize(raw, tests);
    return {
      passed: results.every((r) => r.passed),
      results,
      stdout: stdout.split("\n").filter((l) => !l.startsWith(MARKER)).join("\n").trim(),
      durationMs: Math.round(performance.now() - started),
      runner: this.name,
    };
  }
}
