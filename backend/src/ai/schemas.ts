import { z } from "zod";

/**
 * Structured-output schemas shared by every LLM provider. Nullable (rather than optional) fields keep
 * the schemas compatible with strict JSON-schema structured output modes.
 */
export const ConceptSchema = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "kebab-case key"),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
});

export const LessonDraftSchema = z.object({
  title: z.string().min(1).max(160),
  conceptKey: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  minutes: z.number().int().min(1).max(120),
  content: z.string().min(40).describe("Markdown. May use $$KaTeX$$, ```code``` and ```mermaid``` blocks."),
});

export const CourseOutlineSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().min(10).max(1000),
  level: z.number().int().min(1).max(5),
  concepts: z.array(ConceptSchema).min(1).max(20),
  modules: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        summary: z.string().min(1).max(600),
        lessons: z.array(LessonDraftSchema).min(1).max(8),
      }),
    )
    .min(1)
    .max(8),
});
export type CourseOutline = z.infer<typeof CourseOutlineSchema>;

export const CodeSpecSchema = z.object({
  entrypoint: z.string().regex(/^[A-Za-z_$][\w$]*$/),
  starterCode: z.string(),
  solution: z.string(),
  tests: z
    .array(z.object({ args: z.string().describe("JSON array of arguments"), expected: z.string().describe("JSON value") }))
    .min(1)
    .max(10),
});
export type CodeSpec = z.infer<typeof CodeSpecSchema>;

export const QuestionTypeSchema = z.enum(["MCQ", "TRUE_FALSE", "SHORT_ANSWER", "CODE"]);
export type QuestionKind = z.infer<typeof QuestionTypeSchema>;

export const QuestionDraftSchema = z.object({
  type: QuestionTypeSchema,
  prompt: z.string().min(5).max(2000),
  options: z.array(z.string()).max(6).describe("MCQ options; empty for other types"),
  answer: z.string().describe("MCQ: exact option text; TRUE_FALSE: 'true'|'false'; SHORT_ANSWER: model answer; CODE: reference solution"),
  explanation: z.string().min(1).max(2000),
  conceptKey: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  keyPoints: z.array(z.string()).max(8).describe("SHORT_ANSWER grading rubric; empty otherwise"),
  code: CodeSpecSchema.nullable(),
});
export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;

export const QuizDraftSchema = z.object({
  title: z.string().min(3).max(160),
  questions: z.array(QuestionDraftSchema).min(1).max(20),
});
export type QuizDraft = z.infer<typeof QuizDraftSchema>;

export const FlashcardSetSchema = z.object({
  cards: z
    .array(z.object({ front: z.string().min(2).max(400), back: z.string().min(1).max(1200), conceptKey: z.string().min(1) }))
    .min(1)
    .max(40),
});
export type FlashcardSet = z.infer<typeof FlashcardSetSchema>;

export const GradeSchema = z.object({
  score: z.number().min(0).max(1),
  correct: z.boolean(),
  feedback: z.string().min(1).max(1500),
  missedPoints: z.array(z.string()),
});
export type Grade = z.infer<typeof GradeSchema>;

export const JudgeReportSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().min(0),
      valid: z.boolean(),
      issues: z.array(z.string()),
    }),
  ),
  summary: z.string(),
});
export type JudgeReport = z.infer<typeof JudgeReportSchema>;

export const HintSchema = z.object({ hint: z.string().min(1).max(1500) });
export type Hint = z.infer<typeof HintSchema>;
