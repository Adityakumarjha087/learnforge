import { bktUpdate, DEFAULT_BKT, guessFor, isMastered, MASTERY_THRESHOLD } from "../learning/bkt";
import { BASE_RATING, eloUpdate } from "../learning/elo";
import type { Db } from "../lib/prisma";

export interface Observation {
  correct: boolean;
  score: number;
  type: "MCQ" | "TRUE_FALSE" | "SHORT_ANSWER" | "CODE";
  optionCount?: number;
  questionRating?: number;
}

export interface MasteryDelta {
  conceptId: string;
  before: number;
  after: number;
  rating: number;
}

/** Update BKT mastery and the learner's Elo rating for a concept from one observation. */
export async function observe(db: Db, userId: string, conceptId: string, obs: Observation): Promise<MasteryDelta> {
  const current = await db.conceptMastery.findUnique({ where: { userId_conceptId: { userId, conceptId } } });
  const before = current?.pKnown ?? DEFAULT_BKT.pInit;
  const after = bktUpdate(before, obs.correct, { ...DEFAULT_BKT, pGuess: guessFor(obs.type, obs.optionCount) });
  const elo = eloUpdate(current?.rating ?? BASE_RATING, obs.questionRating ?? BASE_RATING, obs.score, current?.attempts ?? 0);
  const row = await db.conceptMastery.upsert({
    where: { userId_conceptId: { userId, conceptId } },
    create: { userId, conceptId, pKnown: after, rating: elo.learner, attempts: 1, correct: obs.correct ? 1 : 0 },
    update: { pKnown: after, rating: elo.learner, attempts: { increment: 1 }, correct: { increment: obs.correct ? 1 : 0 } },
  });
  return { conceptId, before, after: row.pKnown, rating: row.rating };
}

export async function courseMastery(db: Db, userId: string, courseId: string) {
  const concepts = await db.concept.findMany({
    where: { courseId },
    include: { mastery: { where: { userId } } },
    orderBy: { name: "asc" },
  });
  return concepts.map((c) => {
    const m = c.mastery[0];
    const pKnown = m?.pKnown ?? DEFAULT_BKT.pInit;
    return {
      conceptId: c.id,
      key: c.key,
      name: c.name,
      pKnown,
      rating: m?.rating ?? BASE_RATING,
      attempts: m?.attempts ?? 0,
      accuracy: m && m.attempts ? m.correct / m.attempts : null,
      mastered: isMastered(pKnown),
    };
  });
}

export async function masteryMap(db: Db, userId: string, conceptIds: string[]) {
  const rows = await db.conceptMastery.findMany({ where: { userId, conceptId: { in: conceptIds } } });
  return new Map(rows.map((r) => [r.conceptId, { pKnown: r.pKnown, attempts: r.attempts, rating: r.rating }]));
}

export { MASTERY_THRESHOLD };
