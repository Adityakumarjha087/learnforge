import type { Prisma, Question } from "@prisma/client";
import { ai } from "../ai";
import type { QuestionDraft } from "../ai/schemas";
import type { AuthUser } from "../auth/tokens";
import { XP } from "../gamification/rules";
import { awardXp, type XpAward } from "../gamification/service";
import { difficultyLabel, targetDifficulty } from "../learning/adaptive";
import { eloUpdate, ratingForDifficulty } from "../learning/elo";
import { AppError, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import type { Db } from "../lib/prisma";
import { getSandbox } from "../sandbox";
import type { TestCase } from "../sandbox/types";
import { getLesson } from "./course";
import { observe, type MasteryDelta } from "./mastery";
import { assertQuota, recordUsage } from "./usage";

const MIN_VALID_QUESTIONS = 3;

export interface QualityReport {
  provider: string;
  summary: string;
  generated: number;
  accepted: number;
  rejected: { prompt: string; issues: string[] }[];
}

/**
 * Quality gate for generated items: an LLM-as-judge review plus deterministic checks, and for code
 * questions the reference solution must pass its own tests in the sandbox.
 */
export async function qualityGate(drafts: QuestionDraft[], sourceText: string): Promise<{ accepted: QuestionDraft[]; report: QualityReport }> {
  const judge = await ai().run("judge", { sourceText, questions: drafts });
  const verdicts = new Map(judge.verdicts.map((v) => [v.index, v]));
  const accepted: QuestionDraft[] = [];
  const rejected: QualityReport["rejected"] = [];
  for (const [i, q] of drafts.entries()) {
    const issues = [...(verdicts.get(i)?.issues ?? [])];
    if (verdicts.get(i)?.valid === false && issues.length === 0) issues.push("Rejected by reviewer");
    if (q.type === "CODE" && q.code) {
      try {
        const run = await getSandbox().run("javascript", q.code.solution, q.code.entrypoint, q.code.tests);
        if (!run.passed) issues.push("Reference solution fails its own test cases");
      } catch (err) {
        issues.push(`Reference solution could not be executed: ${(err as Error).message}`);
      }
    }
    if (issues.length) rejected.push({ prompt: q.prompt, issues });
    else accepted.push(q);
  }
  return {
    accepted,
    report: {
      provider: ai().judge.name,
      summary: rejected.length ? `${rejected.length} of ${drafts.length} generated items were rejected by the quality gate.` : judge.summary,
      generated: drafts.length,
      accepted: accepted.length,
      rejected,
    },
  };
}

export async function generateQuiz(db: Db, user: AuthUser, lessonId: string, opts: { difficulty?: number; count?: number } = {}) {
  await assertQuota(db, user, "quiz");
  const lesson = await getLesson(db, user, lessonId);
  const course = await db.course.findUniqueOrThrow({ where: { id: lesson.course.id }, include: { concepts: true } });
  const mastery = lesson.mastery ?? 0.2;
  const difficulty = opts.difficulty ?? targetDifficulty(mastery);
  const concepts = lesson.concept ? [{ key: lesson.concept.key, name: lesson.concept.name }] : course.concepts.slice(0, 3).map((c) => ({ key: c.key, name: c.name }));

  const draft = await ai().run("quiz", {
    courseTitle: course.title,
    lessonTitle: lesson.title,
    lessonContent: lesson.content,
    concepts,
    difficulty,
    count: opts.count ?? 5,
    includeCode: true,
  });
  const { accepted, report } = await qualityGate(draft.questions, lesson.content);
  const status = accepted.length >= Math.min(MIN_VALID_QUESTIONS, draft.questions.length) ? "PUBLISHED" : "REJECTED";
  const conceptIds = new Map(course.concepts.map((c) => [c.key, c.id]));

  const quiz = await db.$transaction(async (tx) => {
    const q = await tx.quiz.create({
      data: {
        courseId: course.id,
        lessonId,
        title: `${draft.title} (${difficultyLabel(difficulty)})`,
        difficulty,
        status,
        judgeReport: report as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });
    for (const [order, d] of accepted.entries()) {
      let exerciseId: string | undefined;
      if (d.type === "CODE" && d.code) {
        const ex = await tx.codeExercise.create({
          data: {
            courseId: course.id,
            lessonId,
            title: d.prompt.split(/[.:]/)[0]!.slice(0, 80),
            prompt: d.prompt,
            language: "javascript",
            entrypoint: d.code.entrypoint,
            starterCode: d.code.starterCode,
            solution: d.code.solution,
            tests: d.code.tests as unknown as Prisma.InputJsonValue,
          },
        });
        exerciseId = ex.id;
      }
      await tx.question.create({
        data: {
          quizId: q.id,
          conceptId: conceptIds.get(d.conceptKey) ?? lesson.conceptId,
          type: d.type,
          prompt: d.prompt,
          options: d.type === "MCQ" || d.type === "TRUE_FALSE" ? d.options : undefined,
          answer: d.answer,
          explanation: d.explanation,
          rubric: d.type === "SHORT_ANSWER" ? { keyPoints: d.keyPoints } : undefined,
          rating: ratingForDifficulty(d.difficulty),
          order,
          exerciseId,
        },
      });
    }
    return q;
  });
  await recordUsage(db, user.id, "quiz");
  logger.info({ quizId: quiz.id, status, accepted: accepted.length, rejected: report.rejected.length }, "quiz generated");
  return { quizId: quiz.id, status, report };
}

/** Adaptive entry point: reuse a published quiz at the learner's target difficulty, or generate one. */
export async function adaptiveQuiz(db: Db, user: AuthUser, lessonId: string) {
  const lesson = await getLesson(db, user, lessonId);
  const difficulty = targetDifficulty(lesson.mastery ?? 0.2);
  const attempted = await db.quizAttempt.findMany({ where: { userId: user.id, completedAt: { not: null }, quiz: { lessonId } }, select: { quizId: true } });
  const existing = await db.quiz.findFirst({
    where: { lessonId, status: "PUBLISHED", difficulty, id: { notIn: attempted.map((a) => a.quizId) } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { quizId: existing.id, difficulty, generated: false };
  const created = await generateQuiz(db, user, lessonId, { difficulty });
  if (created.status !== "PUBLISHED") throw new AppError("UNPROCESSABLE", "Generated quiz did not pass the quality gate; please try again.");
  return { quizId: created.quizId, difficulty, generated: true };
}

const publicQuestion = (q: Question & { exercise?: { starterCode: string; entrypoint: string; tests: Prisma.JsonValue } | null }) => ({
  id: q.id,
  type: q.type,
  prompt: q.prompt,
  options: (q.options as string[] | null) ?? [],
  order: q.order,
  code: q.exercise ? { starterCode: q.exercise.starterCode, entrypoint: q.exercise.entrypoint, tests: q.exercise.tests as unknown as TestCase[] } : null,
});

export async function getQuiz(db: Db, user: AuthUser, quizId: string) {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    include: { course: { select: { id: true, title: true, authorId: true, status: true } }, lesson: { select: { id: true, title: true } }, questions: { orderBy: { order: "asc" }, include: { exercise: true } } },
  });
  if (!quiz) throw notFound("Quiz");
  const isAuthor = user.role === "ADMIN" || quiz.course.authorId === user.id;
  if (quiz.status !== "PUBLISHED" && !isAuthor) throw forbidden("This quiz is not published");
  return {
    id: quiz.id,
    title: quiz.title,
    difficulty: quiz.difficulty,
    status: quiz.status,
    course: { id: quiz.course.id, title: quiz.course.title },
    lesson: quiz.lesson,
    judgeReport: isAuthor ? (quiz.judgeReport as unknown as QualityReport | null) : null,
    questions: quiz.questions.map(publicQuestion),
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export interface GradedResponse {
  questionId: string;
  correct: boolean;
  score: number;
  feedback: string;
  explanation: string;
  correctAnswer: string | null;
}

async function gradeOne(q: Question & { exercise: { entrypoint: string; tests: Prisma.JsonValue } | null }, answer: string): Promise<GradedResponse> {
  const base = { questionId: q.id, explanation: q.explanation };
  switch (q.type) {
    case "MCQ":
    case "TRUE_FALSE": {
      const correct = norm(answer) === norm(q.answer);
      return { ...base, correct, score: correct ? 1 : 0, feedback: correct ? "Correct!" : `Not quite - the answer is "${q.answer}".`, correctAnswer: q.answer };
    }
    case "SHORT_ANSWER": {
      const keyPoints = ((q.rubric as { keyPoints?: string[] } | null)?.keyPoints ?? []).filter(Boolean);
      const grade = await ai().run("grade", { question: q.prompt, modelAnswer: q.answer, keyPoints, response: answer });
      return { ...base, correct: grade.correct, score: grade.score, feedback: grade.feedback, correctAnswer: q.answer };
    }
    case "CODE": {
      if (!q.exercise) return { ...base, correct: false, score: 0, feedback: "Exercise is missing", correctAnswer: null };
      const tests = q.exercise.tests as unknown as TestCase[];
      const run = await getSandbox().run("javascript", answer, q.exercise.entrypoint, tests);
      const passed = run.results.filter((r) => r.passed).length;
      return {
        ...base,
        correct: run.passed,
        score: passed / Math.max(1, tests.length),
        feedback: run.passed ? `All ${tests.length} tests passed.` : `${passed}/${tests.length} tests passed.`,
        correctAnswer: null,
      };
    }
  }
}

export async function submitQuiz(db: Db, user: AuthUser, quizId: string, answers: { questionId: string; answer: string }[]) {
  const quiz = await db.quiz.findUnique({ where: { id: quizId }, include: { questions: { include: { exercise: true } }, course: true } });
  if (!quiz) throw notFound("Quiz");
  if (quiz.status !== "PUBLISHED" && quiz.course.authorId !== user.id && user.role !== "ADMIN") throw forbidden("This quiz is not published");
  const byId = new Map(answers.map((a) => [a.questionId, a.answer]));
  const graded: GradedResponse[] = [];
  const deltas: MasteryDelta[] = [];
  for (const q of quiz.questions.sort((a, b) => a.order - b.order)) {
    const g = await gradeOne(q, byId.get(q.id) ?? "");
    graded.push(g);
    if (q.conceptId) {
      const d = await observe(db, user.id, q.conceptId, {
        correct: g.correct,
        score: g.score,
        type: q.type,
        optionCount: (q.options as string[] | null)?.length,
        questionRating: q.rating,
      });
      deltas.push(d);
      const elo = eloUpdate(d.rating, q.rating, g.score, 20);
      await db.question.update({ where: { id: q.id }, data: { rating: elo.question } });
    }
  }
  const score = graded.length ? graded.reduce((s, g) => s + g.score, 0) / graded.length : 0;
  const attempt = await db.quizAttempt.create({
    data: {
      quizId,
      userId: user.id,
      score,
      completedAt: new Date(),
      responses: {
        create: graded.map((g) => ({ questionId: g.questionId, answer: byId.get(g.questionId) ?? "", correct: g.correct, score: g.score, feedback: g.feedback })),
      },
    },
  });
  const correctCount = graded.filter((g) => g.correct).length;
  const xp = correctCount * XP.correctAnswer + (correctCount === graded.length && graded.length > 0 ? XP.perfectQuiz : 0);
  const award: XpAward = await awardXp(db, user.id, xp, "quiz");
  // Collapse per-question deltas to one before/after per concept.
  const perConcept = new Map<string, { conceptId: string; before: number; after: number }>();
  for (const d of deltas) {
    const prev = perConcept.get(d.conceptId);
    perConcept.set(d.conceptId, { conceptId: d.conceptId, before: prev?.before ?? d.before, after: d.after });
  }
  const names = await db.concept.findMany({ where: { id: { in: [...perConcept.keys()] } }, select: { id: true, name: true } });
  return {
    attemptId: attempt.id,
    score,
    correct: correctCount,
    total: graded.length,
    results: graded,
    mastery: [...perConcept.values()].map((m) => ({ ...m, name: names.find((n) => n.id === m.conceptId)?.name ?? "" })),
    award,
    nextDifficulty: targetDifficulty(deltas.at(-1)?.after ?? 0.2),
  };
}

export async function quizzesForCourse(db: Db, user: AuthUser, courseId: string) {
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound("Course");
  const isAuthor = user.role === "ADMIN" || course.authorId === user.id;
  const quizzes = await db.quiz.findMany({
    where: { courseId, ...(isAuthor ? {} : { status: "PUBLISHED" }) },
    orderBy: { createdAt: "desc" },
    include: { lesson: { select: { title: true } }, _count: { select: { questions: true, attempts: true } } },
  });
  return quizzes.map((q) => ({ ...q, judgeReport: isAuthor ? (q.judgeReport as unknown as QualityReport | null) : null }));
}

export async function setQuizStatus(db: Db, user: AuthUser, quizId: string, status: "PUBLISHED" | "REJECTED" | "DRAFT") {
  const quiz = await db.quiz.findUnique({ where: { id: quizId }, include: { course: true } });
  if (!quiz) throw notFound("Quiz");
  if (quiz.course.authorId !== user.id && user.role !== "ADMIN") throw forbidden();
  return db.quiz.update({ where: { id: quizId }, data: { status } });
}

export async function attemptHistory(db: Db, user: AuthUser, take = 10) {
  return db.quizAttempt.findMany({
    where: { userId: user.id, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take,
    include: { quiz: { select: { id: true, title: true, course: { select: { id: true, title: true } } } } },
  });
}
