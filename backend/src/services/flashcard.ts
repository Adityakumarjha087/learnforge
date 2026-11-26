import type { ReviewCard } from "@prisma/client";
import { ai } from "../ai";
import type { AuthUser } from "../auth/tokens";
import { XP } from "../gamification/rules";
import { awardXp } from "../gamification/service";
import { previewIntervals, review, type Rating, type SrsCard } from "../learning/fsrs";
import { ratingToQuality, sm2 } from "../learning/sm2";
import { notFound } from "../lib/errors";
import type { Db } from "../lib/prisma";
import { observe } from "./mastery";

const NEW_CARDS_PER_DAY = 20;
const DAY = 86_400_000;

export type SrsAlgorithm = "fsrs" | "sm2";
export const srsAlgorithm = (): SrsAlgorithm => (process.env.SRS_ALGORITHM === "sm2" ? "sm2" : "fsrs");

export async function generateFlashcardsForCourse(db: Db, courseId: string, count = 12): Promise<number> {
  const course = await db.course.findUniqueOrThrow({
    where: { id: courseId },
    include: { concepts: true, modules: { include: { lessons: { select: { content: true } } } } },
  });
  const content = course.modules.flatMap((m) => m.lessons.map((l) => l.content)).join("\n\n");
  const set = await ai().run("flashcards", {
    courseTitle: course.title,
    content,
    concepts: course.concepts.map((c) => ({ key: c.key, name: c.name, description: c.description })),
    count,
  });
  const byKey = new Map(course.concepts.map((c) => [c.key, c.id]));
  await db.flashcard.createMany({
    data: set.cards.map((c) => ({ courseId, conceptId: byKey.get(c.conceptKey) ?? null, front: c.front, back: c.back })),
  });
  return set.cards.length;
}

const toSrs = (c: ReviewCard): SrsCard => ({
  state: c.state,
  due: c.due,
  stability: c.stability,
  difficulty: c.difficulty,
  reps: c.reps,
  lapses: c.lapses,
  scheduledDays: c.scheduledDays,
  lastReview: c.lastReview,
});

/** Lazily materialise per-user review cards for courses the learner is enrolled in (capped new cards/day). */
async function ensureCards(db: Db, userId: string, courseId?: string) {
  const startOfDay = new Date(Math.floor(Date.now() / DAY) * DAY);
  const introducedToday = await db.reviewCard.count({ where: { userId, createdAt: { gte: startOfDay } } });
  const budget = Math.max(0, NEW_CARDS_PER_DAY - introducedToday);
  if (budget === 0) return;
  const courseIds = courseId ? [courseId] : (await db.enrollment.findMany({ where: { userId }, select: { courseId: true } })).map((e) => e.courseId);
  const fresh = await db.flashcard.findMany({
    where: { courseId: { in: courseIds }, reviews: { none: { userId } } },
    orderBy: { createdAt: "asc" },
    take: budget,
    select: { id: true },
  });
  if (fresh.length) {
    await db.reviewCard.createMany({ data: fresh.map((f) => ({ userId, flashcardId: f.id })), skipDuplicates: true });
  }
}

export async function dueQueue(db: Db, user: AuthUser, opts: { courseId?: string; limit?: number } = {}) {
  await ensureCards(db, user.id, opts.courseId);
  const now = new Date();
  const where = { userId: user.id, due: { lte: now }, ...(opts.courseId ? { flashcard: { courseId: opts.courseId } } : {}) };
  const [cards, counts] = await Promise.all([
    db.reviewCard.findMany({
      where,
      orderBy: [{ due: "asc" }],
      take: opts.limit ?? 50,
      include: { flashcard: { include: { course: { select: { id: true, title: true } }, concept: { select: { name: true } } } } },
    }),
    db.reviewCard.groupBy({ by: ["state"], where, _count: true }),
  ]);
  const count = (s: string) => counts.find((c) => c.state === s)?._count ?? 0;
  return {
    algorithm: srsAlgorithm(),
    counts: { new: count("NEW"), learning: count("LEARNING") + count("RELEARNING"), review: count("REVIEW"), total: counts.reduce((s, c) => s + c._count, 0) },
    cards: cards.map((c) => ({
      id: c.flashcardId,
      front: c.flashcard.front,
      back: c.flashcard.back,
      course: c.flashcard.course,
      concept: c.flashcard.concept?.name ?? null,
      state: c.state,
      intervals: Object.fromEntries(Object.entries(previewIntervals(toSrs(c), now)).map(([k, v]) => [k, v.days])) as Record<"again" | "hard" | "good" | "easy", number>,
    })),
  };
}

export async function reviewCard(db: Db, user: AuthUser, flashcardId: string, rating: Rating, now = new Date()) {
  const card = await db.reviewCard.findUnique({ where: { userId_flashcardId: { userId: user.id, flashcardId } }, include: { flashcard: true } });
  if (!card) throw notFound("Review card");
  let next: SrsCard;
  let elapsedDays = card.lastReview ? (now.getTime() - card.lastReview.getTime()) / DAY : 0;
  if (srsAlgorithm() === "sm2") {
    const s = sm2({ repetitions: card.reps, easiness: card.difficulty || 2.5, intervalDays: card.scheduledDays }, ratingToQuality(rating));
    next = {
      ...toSrs(card),
      state: s.repetitions === 0 ? "RELEARNING" : "REVIEW",
      reps: s.repetitions,
      difficulty: s.easiness,
      scheduledDays: s.intervalDays,
      stability: s.intervalDays,
      due: new Date(now.getTime() + s.intervalDays * DAY),
      lastReview: now,
      lapses: card.lapses + (rating === 1 ? 1 : 0),
    };
  } else {
    const out = review(toSrs(card), rating, now);
    next = out.card;
    elapsedDays = out.log.elapsedDays;
  }
  await db.$transaction([
    db.reviewCard.update({
      where: { id: card.id },
      data: {
        state: next.state,
        due: next.due,
        stability: next.stability,
        difficulty: next.difficulty,
        reps: next.reps,
        lapses: next.lapses,
        scheduledDays: next.scheduledDays,
        lastReview: next.lastReview,
      },
    }),
    db.reviewLog.create({ data: { userId: user.id, flashcardId, rating, state: card.state, elapsedDays, scheduledDays: next.scheduledDays, reviewedAt: now } }),
  ]);
  // Recall evidence feeds the mastery model (flashcard recall behaves like a low-guess item).
  if (card.flashcard.conceptId) {
    await observe(db, user.id, card.flashcard.conceptId, { correct: rating >= 3, score: rating >= 3 ? 1 : 0, type: "SHORT_ANSWER" });
  }
  const award = await awardXp(db, user.id, XP.flashcardReview, "flashcard-review", now);
  return { due: next.due, scheduledDays: next.scheduledDays, state: next.state, award };
}

export async function reviewStats(db: Db, user: AuthUser) {
  const now = Date.now();
  const since = new Date(now - 30 * DAY);
  const [logs, upcoming, today] = await Promise.all([
    db.reviewLog.findMany({ where: { userId: user.id, reviewedAt: { gte: since }, state: "REVIEW" }, select: { rating: true } }),
    db.reviewCard.findMany({ where: { userId: user.id, due: { gt: new Date(now), lte: new Date(now + 7 * DAY) } }, select: { due: true } }),
    db.reviewLog.count({ where: { userId: user.id, reviewedAt: { gte: new Date(Math.floor(now / DAY) * DAY) } } }),
  ]);
  const forecast = Array.from({ length: 7 }, (_, i) => ({
    day: i + 1,
    count: upcoming.filter((u) => Math.ceil((u.due.getTime() - now) / DAY) === i + 1).length,
  }));
  return {
    reviewedToday: today,
    retention: logs.length ? logs.filter((l) => l.rating >= 2).length / logs.length : null,
    matureReviews: logs.length,
    forecast,
  };
}
