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

  async run<K extends Task>(task: K, input: TaskIO[K]["input"]): Promise<TaskIO[K]["output"]> {
    const started = performance.now();
    const llm = task === "judge" ? this.judge : this.provider;
    const raw = await llm.generate(task, input, buildPrompt(task, input));
    const parsed = TASK_SCHEMAS[task].safeParse(raw);
    const ms = Math.round(performance.now() - started);
    if (!parsed.success) {
      logger.warn({ task, provider: llm.name, issues: parsed.error.issues.slice(0, 5) }, "llm output failed schema validation");
      throw new AppError("UNPROCESSABLE", `AI output for ${task} failed validation`, parsed.error.issues.slice(0, 5));
    }
    logger.debug({ task, provider: llm.name, model: llm.model, ms }, "llm task complete");
    return parsed.data;
  }

  streamTutor(input: TutorInput, signal?: AbortSignal): AsyncIterable<string> {
    return this.provider.streamChat(buildTutorSystem(input), input, signal);
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
