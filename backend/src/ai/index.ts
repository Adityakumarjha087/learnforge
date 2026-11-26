import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { buildPrompt, buildTutorSystem } from "./prompts";
import { AnthropicLLM } from "./providers/anthropic";
import { createAiSdkProvider } from "./providers/aisdk";
import { FakeLLM } from "./providers/fake";
import { TASK_SCHEMAS } from "./registry";
import type { LLMProvider, Task, TaskIO, TutorInput } from "./types";

/**
 * Facade over the configured provider: builds prompts, validates every structured output
 * against its Zod schema (regardless of provider) and logs latency.
 */
export class AiService {
  constructor(
    readonly provider: LLMProvider,
    readonly judge: LLMProvider = provider,
  ) {}

  /**
   * Run a structured task. Output is repaired when possible (JSON inside a string / code fence) and validated;
   * on failure the call is retried with the validation errors appended, then fails with a clean domain error.
   */
  async run<K extends Task>(task: K, input: TaskIO[K]["input"], maxAttempts = 2): Promise<TaskIO[K]["output"]> {
    const started = performance.now();
    const llm = task === "judge" ? this.judge : this.provider;
    const base = buildPrompt(task, input);
    let lastIssues: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const prompt =
        attempt === 1 ? base : { ...base, prompt: `${base.prompt}\n\nYour previous response was invalid (${JSON.stringify(lastIssues).slice(0, 800)}). Return ONLY JSON that matches the schema.` };
      let raw: unknown;
      try {
        raw = repairJson(await llm.generate(task, input, prompt));
      } catch (err) {
        if (err instanceof AppError && err.code !== "UNPROCESSABLE") throw err;
        lastIssues = (err as Error).message;
        logger.warn({ task, provider: llm.name, attempt, err: lastIssues }, "llm generation failed");
        continue;
      }
      const parsed = TASK_SCHEMAS[task].safeParse(raw);
      if (parsed.success) {
        logger.debug({ task, provider: llm.name, model: llm.model, attempt, ms: Math.round(performance.now() - started) }, "llm task complete");
        return parsed.data;
      }
      lastIssues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
      logger.warn({ task, provider: llm.name, attempt, issues: lastIssues }, "llm output failed schema validation");
    }
    throw new AppError("UNPROCESSABLE", `The AI returned an invalid ${task} after ${maxAttempts} attempts. Please try again.`, lastIssues);
  }

  streamTutor(input: TutorInput, signal?: AbortSignal): AsyncIterable<string> {
    return this.provider.streamChat(buildTutorSystem(input), input, signal);
  }
}

/** Accept JSON delivered as a string (optionally wrapped in a Markdown code fence); otherwise pass through. */
export function repairJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new AppError("UNPROCESSABLE", "Model output contained no JSON");
  try {
    return JSON.parse(candidate.slice(start));
  } catch {
    throw new AppError("UNPROCESSABLE", "Model output was not valid JSON");
  }
}

export function createProvider(model?: string): LLMProvider {
  const e = env();
  switch (e.LLM_PROVIDER) {
    case "fake":
      return new FakeLLM({ errorRate: e.NODE_ENV === "test" ? 0 : 0.15 });
    case "anthropic":
      if (!e.ANTHROPIC_API_KEY) logger.warn("ANTHROPIC_API_KEY not set; relying on SDK credential resolution");
      return AnthropicLLM.fromKey(e.ANTHROPIC_API_KEY, model || e.LLM_MODEL);
    case "openai":
    case "gemini":
    case "ollama":
      if (e.LLM_PROVIDER === "openai" && !e.OPENAI_API_KEY) throw new AppError("INTERNAL", "OPENAI_API_KEY is required");
      if (e.LLM_PROVIDER === "gemini" && !e.GOOGLE_GENERATIVE_AI_API_KEY) throw new AppError("INTERNAL", "GOOGLE_GENERATIVE_AI_API_KEY is required");
      return createAiSdkProvider(e.LLM_PROVIDER, {
        model: model || e.LLM_MODEL,
        openaiKey: e.OPENAI_API_KEY,
        googleKey: e.GOOGLE_GENERATIVE_AI_API_KEY,
        ollamaBaseUrl: e.OLLAMA_BASE_URL,
      });
  }
}

let service: AiService | undefined;
export function ai(): AiService {
  service ??= new AiService(createProvider(), createProvider(env().JUDGE_MODEL || undefined));
  return service;
}
export function setAiServiceForTests(s: AiService | undefined): void {
  service = s;
}
