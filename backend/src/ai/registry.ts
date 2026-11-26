import type { z } from "zod";
import { CourseOutlineSchema, FlashcardSetSchema, GradeSchema, HintSchema, JudgeReportSchema, QuizDraftSchema } from "./schemas";
import type { Task, TaskIO } from "./types";

export const TASK_SCHEMAS: { [K in Task]: z.ZodType<TaskIO[K]["output"]> } = {
  course: CourseOutlineSchema,
  quiz: QuizDraftSchema,
  flashcards: FlashcardSetSchema,
  grade: GradeSchema,
  judge: JudgeReportSchema,
  codeHint: HintSchema,
};
