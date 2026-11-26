import type { AuthUser } from "../auth/tokens";
import { MASTERY_THRESHOLD } from "../learning/bkt";
import { forbidden, notFound } from "../lib/errors";
import type { Db } from "../lib/prisma";

/** Instructor analytics: completion funnel, weak concepts, item analysis and per-learner progress. */
export async function courseAnalytics(db: Db, user: AuthUser, courseId: string) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: {
      concepts: true,
      modules: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" }, select: { id: true, title: true } } } },
    },
  });
  if (!course) throw notFound("Course");
  if (course.authorId !== user.id && user.role !== "ADMIN") throw forbidden("Only the course author can view analytics");

  const lessons = course.modules.flatMap((m) => m.lessons);
  const lessonIds = lessons.map((l) => l.id);
  const conceptIds = course.concepts.map((c) => c.id);

  const [enrollments, progress, mastery, attempts, responses] = await Promise.all([
    db.enrollment.findMany({ where: { courseId }, include: { user: { select: { id: true, name: true, email: true } } } }),
    db.lessonProgress.findMany({ where: { lessonId: { in: lessonIds } }, select: { userId: true, lessonId: true } }),
    db.conceptMastery.findMany({ where: { conceptId: { in: conceptIds } }, select: { userId: true, conceptId: true, pKnown: true, attempts: true, correct: true } }),
    db.quizAttempt.findMany({ where: { quiz: { courseId }, completedAt: { not: null } }, select: { score: true, userId: true } }),
    db.questionResponse.findMany({
      where: { question: { quiz: { courseId } } },
      select: { correct: true, question: { select: { id: true, prompt: true, type: true, rating: true } } },
    }),
  ]);

  const learners = enrollments.filter((e) => e.userId !== course.authorId);
  const learnerIds = new Set(learners.map((l) => l.userId));
  const n = Math.max(1, learnerIds.size);

  const lessonCompletion = lessons.map((l) => {
    const completed = progress.filter((p) => p.lessonId === l.id && learnerIds.has(p.userId)).length;
    return { lessonId: l.id, title: l.title, completed, rate: completed / n };
  });

  const concepts = course.concepts
    .map((c) => {
      const rows = mastery.filter((m) => m.conceptId === c.id && learnerIds.has(m.userId));
      const avg = rows.length ? rows.reduce((s, r) => s + r.pKnown, 0) / rows.length : null;
      const att = rows.reduce((s, r) => s + r.attempts, 0);
      const cor = rows.reduce((s, r) => s + r.correct, 0);
      return {
        conceptId: c.id,
        name: c.name,
        learners: rows.length,
        avgMastery: avg,
        masteredPct: rows.length ? rows.filter((r) => r.pKnown >= MASTERY_THRESHOLD).length / rows.length : null,
        accuracy: att ? cor / att : null,
      };
    })
    .sort((a, b) => (a.avgMastery ?? 1) - (b.avgMastery ?? 1));

  const itemMap = new Map<string, { prompt: string; type: string; rating: number; n: number; correct: number }>();
  for (const r of responses) {
    const it = itemMap.get(r.question.id) ?? { prompt: r.question.prompt, type: r.question.type, rating: r.question.rating, n: 0, correct: 0 };
    it.n++;
    if (r.correct) it.correct++;
    itemMap.set(r.question.id, it);
  }
  const hardestItems = [...itemMap.entries()]
    .map(([id, v]) => ({ questionId: id, ...v, pCorrect: v.correct / v.n }))
    .filter((i) => i.n >= 1)
    .sort((a, b) => a.pCorrect - b.pCorrect)
    .slice(0, 8);

  const perLearner = learners.slice(0, 100).map((e) => {
    const done = progress.filter((p) => p.userId === e.userId).length;
    const mine = attempts.filter((a) => a.userId === e.userId);
    return {
      userId: e.userId,
      name: e.user.name,
      email: e.user.email,
      progress: lessons.length ? done / lessons.length : 0,
      quizzes: mine.length,
      avgScore: mine.length ? mine.reduce((s, a) => s + a.score, 0) / mine.length : null,
    };
  });

  const learnerAttempts = attempts.filter((a) => learnerIds.has(a.userId));
  const completedAll = perLearner.filter((p) => p.progress >= 1).length;
  return {
    course: { id: course.id, title: course.title, status: course.status },
    summary: {
      learners: learnerIds.size,
      completionRate: learnerIds.size ? completedAll / learnerIds.size : 0,
      avgProgress: perLearner.length ? perLearner.reduce((s, p) => s + p.progress, 0) / perLearner.length : 0,
      quizAttempts: learnerAttempts.length,
      avgQuizScore: learnerAttempts.length ? learnerAttempts.reduce((s, a) => s + a.score, 0) / learnerAttempts.length : null,
    },
    lessonCompletion,
    weakConcepts: concepts.filter((c) => c.avgMastery !== null).slice(0, 5),
    concepts,
    hardestItems,
    learners: perLearner,
  };
}

export async function instructorOverview(db: Db, user: AuthUser) {
  const courses = await db.course.findMany({
    where: user.role === "ADMIN" ? {} : { authorId: user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { enrollments: true, quizzes: true, flashcards: true } }, modules: { select: { _count: { select: { lessons: true } } } } },
  });
  return courses.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    source: c.source,
    createdAt: c.createdAt,
    enrollments: c._count.enrollments,
    quizzes: c._count.quizzes,
    flashcards: c._count.flashcards,
    lessons: c.modules.reduce((s, m) => s + m._count.lessons, 0),
  }));
}
