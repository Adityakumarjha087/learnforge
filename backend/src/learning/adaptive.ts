import { expectedScore } from "./elo";

/** Target difficulty 1..5 for content given a mastery probability. */
export function targetDifficulty(pKnown: number): 1 | 2 | 3 | 4 | 5 {
  if (pKnown < 0.35) return 1;
  if (pKnown < 0.55) return 2;
  if (pKnown < 0.75) return 3;
  if (pKnown < 0.9) return 4;
  return 5;
}

export const difficultyLabel = (d: number) => ["", "Intro", "Easy", "Medium", "Hard", "Expert"][d] ?? "Medium";

/**
 * Pick the items whose predicted success probability is closest to the "desirable difficulty"
 * sweet spot (~70%), keeping practice challenging but achievable.
 */
export function selectByElo<T extends { rating: number }>(items: T[], learnerRating: number, count: number, target = 0.7): T[] {
  return [...items]
    .map((item) => ({ item, gap: Math.abs(expectedScore(learnerRating, item.rating) - target) }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, count)
    .map((x) => x.item);
}

export interface LessonNode {
  id: string;
  order: number;
  conceptId: string | null;
  difficulty: number;
}

export interface Recommendation {
  lessonId: string;
  reason: "review-weak-concept" | "next-in-sequence" | "course-complete";
  targetDifficulty: number;
}

/**
 * Next-step recommendation: remediate a weak concept from already-completed lessons first,
 * otherwise continue with the next lesson in sequence.
 */
export function recommendNext(
  lessons: LessonNode[],
  completed: Set<string>,
  mastery: Map<string, { pKnown: number; attempts: number }>,
): Recommendation | null {
  const ordered = [...lessons].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return null;

  const weak = ordered
    .filter((l) => completed.has(l.id) && l.conceptId)
    .map((l) => ({ l, m: mastery.get(l.conceptId as string) }))
    .filter((x) => x.m && x.m.attempts >= 2 && x.m.pKnown < 0.4)
    .sort((a, b) => (a.m?.pKnown ?? 0) - (b.m?.pKnown ?? 0))[0];
  if (weak) return { lessonId: weak.l.id, reason: "review-weak-concept", targetDifficulty: targetDifficulty(weak.m!.pKnown) };

  const next = ordered.find((l) => !completed.has(l.id));
  if (next) {
    const pk = next.conceptId ? (mastery.get(next.conceptId)?.pKnown ?? 0.2) : 0.2;
    return { lessonId: next.id, reason: "next-in-sequence", targetDifficulty: targetDifficulty(pk) };
  }
  const last = ordered[ordered.length - 1]!;
  return { lessonId: last.id, reason: "course-complete", targetDifficulty: 5 };
}
