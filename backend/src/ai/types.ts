import type { CodeSpec, CourseOutline, FlashcardSet, Grade, Hint, JudgeReport, QuestionDraft, QuizDraft } from "./schemas";

export interface CourseInput {
  topic: string;
  level: number;
  /** Extracted text of uploaded material (PDF/notes). When present, the course must be grounded in it. */
  sourceText?: string;
  moduleCount?: number;
}

export interface QuizInput {
  courseTitle: string;
  lessonTitle: string;
  lessonContent: string;
  concepts: { key: string; name: string }[];
  difficulty: number;
  count: number;
  includeCode: boolean;
}

export interface FlashcardInput {
  courseTitle: string;
  content: string;
  concepts: { key: string; name: string; description: string }[];
  count: number;
}

export interface GradeInput {
  question: string;
  modelAnswer: string;
  keyPoints: string[];
  response: string;
}

export interface JudgeInput {
  sourceText: string;
  questions: QuestionDraft[];
}

export interface CodeHintInput {
  prompt: string;
  code: string;
  entrypoint: string;
  failures: { args: string; expected: string; actual: string | null; error: string | null }[];
}

export interface TaskIO {
  course: { input: CourseInput; output: CourseOutline };
  quiz: { input: QuizInput; output: QuizDraft };
  flashcards: { input: FlashcardInput; output: FlashcardSet };
  grade: { input: GradeInput; output: Grade };
  judge: { input: JudgeInput; output: JudgeReport };
  codeHint: { input: CodeHintInput; output: Hint };
}
export type Task = keyof TaskIO;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TutorInput {
  courseTitle: string;
  lessonTitle?: string;
  context: { content: string; score: number }[];
  messages: ChatMessage[];
}

export interface PromptPair {
  system: string;
  prompt: string;
}

/** Pluggable LLM backend. `generate` must return schema-valid output; `streamChat` yields text deltas. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate<K extends Task>(task: K, input: TaskIO[K]["input"], prompt: PromptPair): Promise<unknown>;
  streamChat(system: string, input: TutorInput, signal?: AbortSignal): AsyncIterable<string>;
}

export type { CodeSpec };
