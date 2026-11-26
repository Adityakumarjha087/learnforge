import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output, streamText, type LanguageModel } from "ai";
import { TASK_SCHEMAS } from "../registry";
import type { LLMProvider, PromptPair, Task, TaskIO, TutorInput } from "../types";

/** OpenAI, Gemini and Ollama through the Vercel AI SDK (structured output via Output.object + Zod). */
export class AiSdkLLM implements LLMProvider {
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly languageModel: LanguageModel,
  ) {}

  async generate<K extends Task>(task: K, _input: TaskIO[K]["input"], prompt: PromptPair): Promise<unknown> {
    const result = await generateText({
      model: this.languageModel,
      system: prompt.system,
      prompt: prompt.prompt,
      output: Output.object({ schema: TASK_SCHEMAS[task] }),
      maxRetries: 2,
    });
    return result.output;
  }

  async *streamChat(system: string, input: TutorInput, signal?: AbortSignal): AsyncIterable<string> {
    const result = streamText({ model: this.languageModel, system, messages: input.messages, abortSignal: signal });
    for await (const delta of result.textStream) yield delta;
  }
}

export function createAiSdkProvider(
  provider: "openai" | "gemini" | "ollama",
  cfg: { model: string; openaiKey: string; googleKey: string; ollamaBaseUrl: string },
): AiSdkLLM {
  switch (provider) {
    case "openai": {
      const model = cfg.model || "gpt-4.1-mini";
      return new AiSdkLLM("openai", model, createOpenAI({ apiKey: cfg.openaiKey })(model));
    }
    case "gemini": {
      const model = cfg.model || "gemini-2.5-flash";
      return new AiSdkLLM("gemini", model, createGoogleGenerativeAI({ apiKey: cfg.googleKey })(model));
    }
    case "ollama": {
      const model = cfg.model || "llama3.1";
      return new AiSdkLLM("ollama", model, createOpenAICompatible({ name: "ollama", baseURL: cfg.ollamaBaseUrl })(model));
    }
  }
}
