export interface TestCase {
  args: string;
  expected: string;
}

export interface TestResult {
  index: number;
  passed: boolean;
  args: string;
  expected: string;
  actual: string | null;
  error: string | null;
}

export interface RunResult {
  passed: boolean;
  results: TestResult[];
  stdout: string;
  durationMs: number;
  runner: string;
}

export interface CodeRunner {
  readonly name: string;
  supports(language: string): boolean;
  run(language: string, code: string, entrypoint: string, tests: TestCase[]): Promise<RunResult>;
}

/** Structural equality on JSON-serialised values (key order insensitive for objects). */
export function jsonEqual(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  try {
    return canonical(JSON.parse(actual)) === canonical(JSON.parse(expected));
  } catch {
    return actual === expected;
  }
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
  return JSON.stringify(v);
}

export const MAX_ACTUAL_CHARS = 2000;
const cap = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n)}…[truncated]` : s);

export function finalize(raw: { actual: string | null; error: string | null }[], tests: TestCase[]): TestResult[] {
  return tests.map((t, index) => {
    const r = raw[index] ?? { actual: null, error: "Test did not run" };
    const passed = !r.error && jsonEqual(r.actual, t.expected);
    return { index, args: t.args, expected: t.expected, actual: cap(r.actual, MAX_ACTUAL_CHARS), error: cap(r.error, 500), passed };
  });
}
