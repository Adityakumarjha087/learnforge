import { env } from "../config/env";
import { badRequest } from "../lib/errors";
import { logger } from "../lib/logger";
import { PistonRunner } from "./piston";
import { QuickJsRunner } from "./quickjs";
import type { CodeRunner, RunResult, TestCase } from "./types";

/**
 * Chooses a sandbox: Piston when configured (multi-language, container isolated), falling back to the
 * in-process QuickJS WASM sandbox for JavaScript. User code is never executed directly on the host.
 */
export class SandboxService {
  constructor(
    private readonly primary: CodeRunner,
    private readonly fallback: CodeRunner | null,
  ) {}

  async run(language: string, code: string, entrypoint: string, tests: TestCase[]): Promise<RunResult> {
    if (code.length > 20_000) throw badRequest("Code is too long (20k characters max)");
    if (this.primary.supports(language)) {
      try {
        return await this.primary.run(language, code, entrypoint, tests);
      } catch (err) {
        if (!this.fallback?.supports(language)) throw err;
        logger.warn({ err: (err as Error).message }, "primary sandbox failed; using fallback");
      }
    }
    if (this.fallback?.supports(language)) return this.fallback.run(language, code, entrypoint, tests);
    const hint = this.primary.name === "quickjs-wasm" && !this.fallback ? " (only JavaScript runs in this deployment; the multi-language Piston sandbox is disabled in the demo)" : "";
    throw badRequest(`Language ${language} is not supported by the configured sandbox${hint}`);
  }
}

let sandbox: SandboxService | undefined;
export function getSandbox(): SandboxService {
  if (!sandbox) {
    const e = env();
    const quick = new QuickJsRunner(e.SANDBOX_TIMEOUT_MS);
    sandbox = e.SANDBOX_PROVIDER === "piston" ? new SandboxService(new PistonRunner(e.PISTON_URL, e.SANDBOX_TIMEOUT_MS), quick) : new SandboxService(quick, null);
  }
  return sandbox;
}
export type { RunResult, TestCase };
