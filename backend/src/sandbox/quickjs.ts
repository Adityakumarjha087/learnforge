import { newQuickJSWASMModule, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import { finalize, type CodeRunner, type RunResult, type TestCase } from "./types";


const IDENT = /^[A-Za-z_$][\w$]*$/;
export const MAX_LOG_LINES = 200;

/**
 * In-process sandbox: JavaScript runs inside the QuickJS engine compiled to WebAssembly. Code has no access
 * to Node APIs, the filesystem or the network, and is bounded by a memory limit, stack limit and deadline.
 * Every run gets a fresh WASM module instance, so a crash or leak in one submission cannot affect another.
 */
export class QuickJsRunner implements CodeRunner {
  readonly name = "quickjs-wasm";
  constructor(
    private readonly timeoutMs = 2000,
    private readonly memoryBytes = 32 * 1024 * 1024,
  ) {}

  supports(language: string): boolean {
    return ["javascript", "js"].includes(language.toLowerCase());
  }

  async run(_language: string, code: string, entrypoint: string, tests: TestCase[]): Promise<RunResult> {
    if (!IDENT.test(entrypoint)) throw new Error("Invalid entrypoint");
    const started = performance.now();
    const QuickJS = await newQuickJSWASMModule();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(this.memoryBytes);
    runtime.setMaxStackSize(512 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.timeoutMs));
    const vm = runtime.newContext();
    const logs: string[] = [];
    let raw: { actual: string | null; error: string | null }[] = [];
    let fatal: string | null = null;

    try {
      const consoleObj = vm.newObject();
      const logFn = vm.newFunction("log", (...args) => {
        if (logs.length < MAX_LOG_LINES) logs.push(args.map((a) => String(vm.dump(a))).join(" ").slice(0, 500));
      });
      vm.setProp(consoleObj, "log", logFn);
      vm.setProp(vm.global, "console", consoleObj);
      logFn.dispose();
      consoleObj.dispose();

      const prelude = vm.evalCode("Object.freeze(JSON); undefined;");
      if (prelude.error) prelude.error.dispose();
      else prelude.value.dispose();

      const user = vm.evalCode(code, "solution.js");
      if (user.error) {
        fatal = formatError(vm.dump(user.error));
        user.error.dispose();
      } else {
        user.value.dispose();
        const harness = `(() => {
          const tests = ${JSON.stringify(tests)};
          const out = [];
          for (const t of tests) {
            try {
              const actual = ${entrypoint}(...JSON.parse(t.args));
              out.push({ actual: actual === undefined ? "undefined" : JSON.stringify(actual), error: null });
            } catch (e) {
              out.push({ actual: null, error: String((e && e.message) || e) });
            }
          }
          return JSON.stringify(out);
        })()`;
        const res = vm.evalCode(harness, "harness.js");
        if (res.error) {
          fatal = formatError(vm.dump(res.error));
          res.error.dispose();
        } else {
          const dumped = vm.dump(res.value);
          raw = typeof dumped === "string" ? JSON.parse(dumped) : tests.map(() => ({ actual: null, error: "Harness tampered with" }));
          res.value.dispose();
        }
      }
    } catch (err) {
      fatal = err instanceof Error ? err.message : String(err);
    } finally {
      // Disposal can assert inside WASM after pathological programs (e.g. stack overflow); the module is discarded anyway.
      try {
        vm.dispose();
        runtime.dispose();
      } catch {
        /* isolated per-run module - safe to drop */
      }
    }

    if (fatal) raw = tests.map(() => ({ actual: null, error: fatal }));
    const results = finalize(raw, tests);
    return {
      passed: results.every((r) => r.passed),
      results,
      stdout: logs.join("\n"),
      durationMs: Math.round(performance.now() - started),
      runner: this.name,
    };
  }
}

function formatError(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { name?: string; message?: string };
    const msg = `${o.name ?? "Error"}: ${o.message ?? JSON.stringify(e)}`;
    return /interrupted/i.test(msg) ? "Execution timed out (interrupted)" : msg;
  }
  return String(e);
}
