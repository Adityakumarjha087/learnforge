import type { Prisma } from "@prisma/client";
import { ai } from "../ai";
import type { AuthUser } from "../auth/tokens";
import { XP } from "../gamification/rules";
import { awardXp } from "../gamification/service";
import { notFound } from "../lib/errors";
import type { Db } from "../lib/prisma";
import { getSandbox } from "../sandbox";
import type { TestCase } from "../sandbox/types";
import { getCourse } from "./course";
import { observe } from "./mastery";

export async function getExercise(db: Db, user: AuthUser, exerciseId: string) {
  const ex = await db.codeExercise.findUnique({ where: { id: exerciseId }, include: { lesson: { select: { id: true, title: true, conceptId: true } } } });
  if (!ex) throw notFound("Exercise");
  const course = await getCourse(db, user, ex.courseId);
  const last = await db.codeSubmission.findFirst({ where: { userId: user.id, exerciseId }, orderBy: { createdAt: "desc" } });
  const passedBefore = await db.codeSubmission.count({ where: { userId: user.id, exerciseId, passed: true } });
  const { solution: _solution, ...rest } = ex;
  return {
    ...rest,
    tests: ex.tests as unknown as TestCase[],
    course: { id: course.id, title: course.title },
    lastCode: last?.code ?? null,
    solved: passedBefore > 0,
  };
}

export async function listExercises(db: Db, user: AuthUser, courseId: string) {
  await getCourse(db, user, courseId);
  const items = await db.codeExercise.findMany({ where: { courseId }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, language: true, lessonId: true } });
  const solved = await db.codeSubmission.findMany({ where: { userId: user.id, passed: true, exerciseId: { in: items.map((i) => i.id) } }, select: { exerciseId: true } });
  const set = new Set(solved.map((s) => s.exerciseId));
  return items.map((i) => ({ ...i, solved: set.has(i.id) }));
}

/** Run learner code in the sandbox against the exercise tests; on failure ask the tutor model for a hint. */
export async function runExercise(db: Db, user: AuthUser, exerciseId: string, code: string) {
  const ex = await db.codeExercise.findUnique({ where: { id: exerciseId }, include: { lesson: { select: { conceptId: true } } } });
  if (!ex) throw notFound("Exercise");
  await getCourse(db, user, ex.courseId);
  const tests = ex.tests as unknown as TestCase[];
  const run = await getSandbox().run(ex.language, code, ex.entrypoint, tests);
  let hint: string | null = null;
  if (!run.passed) {
    const failures = run.results.filter((r) => !r.passed).map((r) => ({ args: r.args, expected: r.expected, actual: r.actual, error: r.error }));
    hint = (await ai().run("codeHint", { prompt: ex.prompt, code, entrypoint: ex.entrypoint, failures })).hint;
  }
  const firstPass = run.passed && (await db.codeSubmission.count({ where: { userId: user.id, exerciseId, passed: true } })) === 0;
  await db.codeSubmission.create({
    data: { userId: user.id, exerciseId, code, passed: run.passed, results: run.results as unknown as Prisma.InputJsonValue, hint },
  });
  if (ex.lesson?.conceptId) {
    await observe(db, user.id, ex.lesson.conceptId, { correct: run.passed, score: run.results.filter((r) => r.passed).length / tests.length, type: "CODE" });
  }
  const award = firstPass ? await awardXp(db, user.id, XP.exercisePassed, "exercise-passed") : null;
  return { ...run, hint, award };
}
