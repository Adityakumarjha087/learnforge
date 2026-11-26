import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { AiService } from "../../src/ai";
import { cosine, HashingEmbedder } from "../../src/ai/embeddings";
import { buildPrompt, buildTutorSystem } from "../../src/ai/prompts";
import { AiSdkLLM, createAiSdkProvider } from "../../src/ai/providers/aisdk";
import { AnthropicLLM, DEFAULT_ANTHROPIC_MODEL } from "../../src/ai/providers/anthropic";
import { FakeLLM } from "../../src/ai/providers/fake";
import { fakeCodeHint, fakeGrade, fakeJudge } from "../../src/ai/providers/fake/assess";
import { fakeCourse } from "../../src/ai/providers/fake/course";
import { fakeFlashcards, fakeQuiz } from "../../src/ai/providers/fake/quiz";
import { fakeTutorReply, streamWords } from "../../src/ai/providers/fake/tutor";
import { CourseOutlineSchema, FlashcardSetSchema, QuizDraftSchema } from "../../src/ai/schemas";
import type { LLMProvider, Task } from "../../src/ai/types";
import { AppError } from "../../src/lib/errors";
import { JS_COURSE } from "../../prisma/seed-data/courses";

const lesson = JS_COURSE.modules[1]!.lessons[0]!; // Arrays and Iteration
const quizInput = (difficulty: number, includeCode = true) => ({
  courseTitle: "JavaScript Fundamentals",
  lessonTitle: lesson.title,
  lessonContent: lesson.content,
  concepts: [{ key: "arrays", name: "Arrays" }],
  difficulty,
  count: 5,
  includeCode,
});

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } };

describe("fake course generator", () => {
  it("builds a schema-valid syllabus from a topic", () => {
    const course = fakeCourse({ topic: "linear algebra", level: 3, moduleCount: 3 });
    expect(CourseOutlineSchema.safeParse(course).success).toBe(true);
    expect(course.modules).toHaveLength(3);
    const keys = new Set(course.concepts.map((c) => c.key));
    for (const l of course.modules.flatMap((m) => m.lessons)) expect(keys.has(l.conceptKey)).toBe(true);
    expect(course.modules[0]!.lessons[0]!.content).toContain("$$"); // math topic gets KaTeX
  });

  it("adds code for programming topics and is deterministic", () => {
    const a = fakeCourse({ topic: "Python programming", level: 1 });
    const b = fakeCourse({ topic: "Python programming", level: 1 });
    expect(a).toEqual(b);
    expect(a.modules[0]!.lessons[0]!.content).toContain("```javascript");
  });

  it("grounds the course in uploaded material", () => {
    const text = JS_COURSE.modules.flatMap((m) => m.lessons.map((l) => l.content)).join("\n\n");
    const course = fakeCourse({ topic: "My JS notes", level: 2, sourceText: text, moduleCount: 2 });
    expect(CourseOutlineSchema.safeParse(course).success).toBe(true);
    const words = course.concepts.map((c) => c.name.toLowerCase());
    expect(words.some((w) => text.toLowerCase().includes(w))).toBe(true);
  });
});

describe("fake quiz generator + judge", () => {
  it("creates a valid mixed quiz including a code question", () => {
    const quiz = fakeQuiz(quizInput(3));
    expect(QuizDraftSchema.safeParse(quiz).success).toBe(true);
    const types = new Set(quiz.questions.map((q) => q.type));
    expect(types.has("CODE")).toBe(true);
    expect(types.has("MCQ")).toBe(true);
    for (const q of quiz.questions.filter((x) => x.type === "MCQ")) expect(q.options).toContain(q.answer);
  });

  it("skips code questions for non-programming content and handles hard/easy mixes", () => {
    const hard = fakeQuiz({ ...quizInput(5), courseTitle: "Biology", lessonTitle: "Cells", lessonContent: "Cells divide by mitosis into two identical daughter cells during growth. Mitosis has four phases called prophase, metaphase, anaphase and telophase." });
    expect(hard.questions.some((q) => q.type === "CODE")).toBe(false);
    const easy = fakeQuiz(quizInput(1, false));
    expect(easy.questions.every((q) => q.type !== "CODE")).toBe(true);
    const empty = fakeQuiz({ ...quizInput(2, false), lessonContent: "Tiny." });
    expect(empty.questions.length).toBeGreaterThanOrEqual(1);
  });

  it("judge accepts a clean quiz and rejects hallucinated answer keys", () => {
    const clean = fakeQuiz(quizInput(2));
    expect(fakeJudge({ sourceText: lesson.content, questions: clean.questions }).verdicts.every((v) => v.valid)).toBe(true);
    const noisy = fakeQuiz(quizInput(2), 1);
    const report = fakeJudge({ sourceText: lesson.content, questions: noisy.questions });
    const mcqs = noisy.questions.map((q, i) => ({ q, i })).filter((x) => x.q.type === "MCQ");
    expect(mcqs.length).toBeGreaterThan(0);
    for (const { i } of mcqs) expect(report.verdicts[i]!.valid).toBe(false);
    expect(report.summary).toMatch(/failed review/);
  });

  it("judge flags structural problems", () => {
    const base = { explanation: "x", conceptKey: "a", difficulty: 2, keyPoints: [], code: null };
    const report = fakeJudge({
      sourceText: "alpha beta gamma",
      questions: [
        { ...base, type: "MCQ", prompt: "Pick one of these options", options: ["a", "a"], answer: "z" },
        { ...base, type: "TRUE_FALSE", prompt: "Is this statement true?", options: ["true", "false"], answer: "maybe" },
        { ...base, type: "SHORT_ANSWER", prompt: "Explain the idea fully", options: [], answer: "x" },
        { ...base, type: "CODE", prompt: "Write some code now", options: [], answer: "x" },
        { ...base, type: "MCQ", prompt: "short", options: ["alpha", "beta"], answer: "alpha", explanation: " " },
      ],
    });
    expect(report.verdicts.map((v) => v.valid)).toEqual([false, false, false, false, false]);
    expect(report.verdicts[0]!.issues.join(" ")).toMatch(/Duplicate options/);
  });
});

describe("fake grading, hints and tutor", () => {
  it("grades short answers by rubric coverage", () => {
    const input = { question: "Explain map", modelAnswer: "The map method creates a new array by applying a function to every element.", keyPoints: ["map", "new array", "function"] };
    const good = fakeGrade({ ...input, response: "map applies a function to each element and returns a new array" });
    expect(good.correct).toBe(true);
    const weak = fakeGrade({ ...input, response: "it loops" });
    expect(weak.correct).toBe(false);
    expect(weak.missedPoints.length).toBeGreaterThan(0);
    expect(fakeGrade({ ...input, response: "" }).score).toBe(0);
  });

  it("gives targeted code hints without solutions", () => {
    const base = { prompt: "sum", code: "function f(){}", entrypoint: "sumArray" };
    expect(fakeCodeHint({ ...base, failures: [] }).hint).toMatch(/All tests pass/);
    expect(fakeCodeHint({ ...base, failures: [{ args: "[]", expected: "1", actual: null, error: "ReferenceError: sumArray is not defined" }] }).hint).toMatch(/named/);
    expect(fakeCodeHint({ ...base, failures: [{ args: "[]", expected: "1", actual: null, error: "Execution timed out (interrupted)" }] }).hint).toMatch(/loop/);
    expect(fakeCodeHint({ ...base, failures: [{ args: "[]", expected: "1", actual: null, error: "TypeError: boom" }] }).hint).toMatch(/threw/);
    expect(fakeCodeHint({ ...base, failures: [{ args: "[]", expected: "1", actual: "undefined", error: null }] }).hint).toMatch(/return/);
    expect(fakeCodeHint({ ...base, failures: [{ args: "[[1,2]]", expected: "3", actual: "2", error: null }] }).hint).toMatch(/off by one/);
    expect(fakeCodeHint({ ...base, failures: [{ args: "[[1,2]]", expected: "3", actual: "30", error: null }] }).hint).toMatch(/Trace/);
  });

  it("tutor is Socratic: masks the key term, refuses to just answer, confirms correct guesses", () => {
    const ctx = [{ content: lesson.content, score: 0.8 }];
    const first = fakeTutorReply({ courseTitle: "JS", lessonTitle: lesson.title, context: ctx, messages: [{ role: "user", content: "Just tell me the answer: what does reduce do with array elements?" }] });
    expect(first).toMatch(/won't hand you the answer/);
    expect(first).toContain("_____");
    const key = first.match(/<!--key:([^>]+)-->/)![1]!;
    const confirm = fakeTutorReply({
      courseTitle: "JS",
      context: ctx,
      messages: [
        { role: "user", content: "what does reduce do?" },
        { role: "assistant", content: first },
        { role: "user", content: `is it ${key}?` },
      ],
    });
    expect(confirm).toMatch(/Exactly/);
  });

  it("tutor handles missing context, math and code questions", () => {
    const reply = fakeTutorReply({ courseTitle: "JS", context: [], messages: [{ role: "user", content: "How do I solve 2x + 3 = 11 in my function code?" }] });
    expect(reply).toMatch(/first principles/);
    expect(reply).toContain("$$");
    expect(reply).toContain("```javascript");
  });

  it("streams words and honours abort", async () => {
    const out: string[] = [];
    for await (const c of streamWords("one two three four five six seven", 0)) out.push(c);
    expect(out.join("")).toBe("one two three four five six seven");
    const ac = new AbortController();
    ac.abort();
    const none: string[] = [];
    for await (const c of streamWords("a b c", 0, ac.signal)) none.push(c);
    expect(none).toEqual([]);
  });

  it("flashcards cover concepts and cloze facts", () => {
    const set = fakeFlashcards({ courseTitle: "JS", content: lesson.content, concepts: [{ key: "arrays", name: "Arrays", description: "Lists" }], count: 6 });
    expect(FlashcardSetSchema.safeParse(set).success).toBe(true);
    expect(set.cards[0]!.front).toMatch(/Arrays/);
    expect(set.cards.some((c) => c.front.startsWith("Complete:"))).toBe(true);
  });
});

describe("AiService", () => {
  it("validates provider output against the task schema", async () => {
    const bad: LLMProvider = { name: "bad", model: "x", generate: async () => ({ nope: true }), streamChat: async function* () {} };
    await expect(new AiService(bad).run("grade", { question: "q", modelAnswer: "a", keyPoints: [], response: "r" })).rejects.toBeInstanceOf(AppError);
  });

  it("routes judge tasks to the judge provider and streams tutor replies", async () => {
    const main = new FakeLLM({ streamDelayMs: 0 });
    const judge = new FakeLLM();
    const spy = vi.spyOn(judge, "generate");
    const svc = new AiService(main, judge);
    await svc.run("judge", { sourceText: "x", questions: [] });
    expect(spy).toHaveBeenCalledOnce();
    let text = "";
    for await (const c of svc.streamTutor({ courseTitle: "c", context: [], messages: [{ role: "user", content: "hello there" }] })) text += c;
    expect(text.length).toBeGreaterThan(20);
    await expect(main.generate("nope" as Task, {} as never, { system: "", prompt: "" })).rejects.toThrow();
  });
});

describe("prompts", () => {
  it("builds prompts for every task", () => {
    expect(buildPrompt("course", { topic: "t", level: 2, sourceText: "material" }).prompt).toContain("source_material");
    expect(buildPrompt("quiz", quizInput(2)).system).toMatch(/MCQ/);
    expect(buildPrompt("flashcards", { courseTitle: "c", content: "x", concepts: [], count: 3 }).prompt).toContain("Cards: 3");
    expect(buildPrompt("grade", { question: "q", modelAnswer: "m", keyPoints: ["k"], response: "r" }).prompt).toContain("learner_answer");
    expect(buildPrompt("judge", { sourceText: "s", questions: [] }).prompt).toContain("<items>");
    expect(buildPrompt("codeHint", { prompt: "p", code: "c", entrypoint: "f", failures: [] }).system).toMatch(/Never write/);
    expect(() => buildPrompt("bogus" as Task, {} as never)).toThrow();
    expect(buildTutorSystem({ courseTitle: "c", lessonTitle: "l", context: [{ content: "ctx", score: 1 }], messages: [] })).toContain("[1] ctx");
    expect(buildTutorSystem({ courseTitle: "c", context: [], messages: [] })).toContain("no material retrieved");
  });
});

describe("AI SDK provider (OpenAI / Gemini / Ollama path)", () => {
  it("generates structured output through Output.object", async () => {
    const grade = { score: 0.8, correct: true, feedback: "Nice", missedPoints: [] };
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(grade) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] }),
    });
    const llm = new AiSdkLLM("mock", "mock-model", model);
    const out = await new AiService(llm).run("grade", { question: "q", modelAnswer: "a", keyPoints: [], response: "r" });
    expect(out).toEqual(grade);
  });

  it("streams chat deltas", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "Hello " },
            { type: "text-delta", id: "1", delta: "learner" },
            { type: "text-end", id: "1" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ],
        }),
      }),
    });
    let text = "";
    for await (const d of new AiSdkLLM("mock", "m", model).streamChat("sys", { courseTitle: "c", context: [], messages: [{ role: "user", content: "hi" }] })) text += d;
    expect(text).toBe("Hello learner");
  });

  it("constructs providers with sensible default models", () => {
    const cfg = { model: "", openaiKey: "k", googleKey: "g", ollamaBaseUrl: "http://localhost:11434/v1" };
    expect(createAiSdkProvider("openai", cfg).model).toBe("gpt-4.1-mini");
    expect(createAiSdkProvider("gemini", cfg).name).toBe("gemini");
    expect(createAiSdkProvider("ollama", { ...cfg, model: "qwen" }).model).toBe("qwen");
  });
});

describe("Anthropic provider", () => {
  function stubClient(parseResult: unknown, events: unknown[] = [], finalStop = "end_turn") {
    const parse = vi.fn(async () => parseResult);
    const stream = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e;
      },
      finalMessage: async () => ({ stop_reason: finalStop }),
    }));
    return { client: { beta: { messages: { parse, stream } } } as never, parse, stream };
  }

  it("uses claude-opus-5-5 with structured output and server-side fallbacks", async () => {
    const grade = { score: 1, correct: true, feedback: "ok", missedPoints: [] };
    const { client, parse } = stubClient({ stop_reason: "end_turn", parsed_output: grade });
    const llm = new AnthropicLLM(client);
    expect(llm.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    const out = await llm.generate("grade", {} as never, { system: "s", prompt: "p" });
    expect(out).toEqual(grade);
    const params = (parse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(params.output_config).toHaveProperty("format");
  });

  it("surfaces refusals, truncation and schema failures as domain errors", async () => {
    for (const r of [{ stop_reason: "refusal" }, { stop_reason: "max_tokens" }, { stop_reason: "end_turn", parsed_output: null }]) {
      const { client } = stubClient(r);
      await expect(new AnthropicLLM(client).generate("course", {} as never, { system: "", prompt: "" })).rejects.toBeInstanceOf(AppError);
    }
  });

  it("streams text deltas and appends a notice on refusal", async () => {
    const events = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Think " } },
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hidden" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "about it" } },
    ];
    const { client } = stubClient(null, events, "refusal");
    let text = "";
    for await (const d of new AnthropicLLM(client, "claude-opus-5-5").streamChat("s", { courseTitle: "c", context: [], messages: [{ role: "user", content: "x" }] })) text += d;
    expect(text.startsWith("Think about it")).toBe(true);
    expect(text).toMatch(/can't help/);
    expect(AnthropicLLM.fromKey("sk-ant-test").model).toBe("claude-opus-5-5");
  });
});

describe("hashing embedder", () => {
  it("produces unit vectors where related text is closer than unrelated text", async () => {
    const e = new HashingEmbedder();
    const [a, b, c] = await e.embed([
      "The dot product of two vectors measures alignment",
      "Vectors with a zero dot product are orthogonal",
      "Photosynthesis converts light into chemical energy",
    ]);
    expect(cosine(a!, a!)).toBeCloseTo(1, 5);
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
    expect(a).toHaveLength(256);
    expect(cosine(e.embedOne(""), e.embedOne(""))).toBe(0);
  });
});
