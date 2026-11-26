import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AppError } from "../../lib/errors";
import { TASK_SCHEMAS } from "../registry";
import type { LLMProvider, PromptPair, Task, TaskIO, TutorInput } from "../types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Claude via the official Anthropic SDK: structured outputs (`messages.parse` + Zod output format)
 * for generation tasks and `messages.stream` for the tutor. Server-side refusal fallbacks are enabled.
 */
export class AnthropicLLM implements LLMProvider {
  readonly name = "anthropic";
  constructor(
    private readonly client: Anthropic,
    readonly model: string = DEFAULT_ANTHROPIC_MODEL,
  ) {}

  static fromKey(apiKey: string, model?: string): AnthropicLLM {
    return new AnthropicLLM(new Anthropic({ apiKey: apiKey || undefined }), model || DEFAULT_ANTHROPIC_MODEL);
  }

  async generate<K extends Task>(task: K, _input: TaskIO[K]["input"], prompt: PromptPair): Promise<unknown> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: task === "grade" || task === "codeHint" ? "low" : "medium", format: betaZodOutputFormat(TASK_SCHEMAS[task]) },
      system: prompt.system,
      messages: [{ role: "user", content: prompt.prompt }],
    });
    if (response.stop_reason === "refusal") throw new AppError("UNPROCESSABLE", "The model declined to generate this content.");
    if (response.stop_reason === "max_tokens") throw new AppError("UNPROCESSABLE", "Generation was truncated; try a smaller request.");
    if (response.parsed_output == null) throw new AppError("UNPROCESSABLE", "Model output did not match the expected schema.");
    return response.parsed_output;
  }

  async *streamChat(system: string, input: TutorInput, signal?: AbortSignal): AsyncIterable<string> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: 64000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") yield "\n\n_I can't help with that request, but I'm happy to keep working through the course material with you._";
  }
}
