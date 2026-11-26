import type { LLMProvider, PromptPair, Task, TaskIO, TutorInput } from "../../types";
import { fakeCodeHint, fakeGrade, fakeJudge } from "./assess";
import { fakeCourse } from "./course";
import { fakeFlashcards, fakeQuiz } from "./quiz";
import { fakeTutorReply, streamWords } from "./tutor";

export interface FakeOptions {
  /** Probability of injecting a wrong answer key into an MCQ (exercises the judge). */
  errorRate?: number;
  streamDelayMs?: number;
}

/** Deterministic offline LLM - the default provider so the app, seed, tests and CI need zero API keys. */
export class FakeLLM implements LLMProvider {
  readonly name = "fake";
  readonly model = "learnforge-fake-1";
  constructor(private readonly opts: FakeOptions = {}) {}

  async generate<K extends Task>(task: K, input: TaskIO[K]["input"], _prompt: PromptPair): Promise<unknown> {
    switch (task) {
      case "course":
        return fakeCourse(input as TaskIO["course"]["input"]);
      case "quiz":
        return fakeQuiz(input as TaskIO["quiz"]["input"], this.opts.errorRate ?? 0);
      case "flashcards":
        return fakeFlashcards(input as TaskIO["flashcards"]["input"]);
      case "grade":
        return fakeGrade(input as TaskIO["grade"]["input"]);
      case "judge":
        return fakeJudge(input as TaskIO["judge"]["input"]);
      case "codeHint":
        return fakeCodeHint(input as TaskIO["codeHint"]["input"]);
      default:
        throw new Error(`FakeLLM: unsupported task ${String(task)}`);
    }
  }

  streamChat(_system: string, input: TutorInput, signal?: AbortSignal): AsyncIterable<string> {
    return streamWords(fakeTutorReply(input), this.opts.streamDelayMs ?? 12, signal);
  }
}
