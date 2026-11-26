/**
 * Elo-style rating for learners (per concept) and questions. A correct answer against a "harder"
 * question moves the learner up more; question ratings converge to their empirical difficulty.
 */
export const BASE_RATING = 1000;

export function expectedScore(learnerRating: number, questionRating: number): number {
  return 1 / (1 + Math.pow(10, (questionRating - learnerRating) / 400));
}

/** K-factor decays with experience so early estimates move fast and later ones stabilise. */
export function kFactor(attempts: number): number {
  return Math.max(16, 48 / (1 + attempts / 8));
}

export function eloUpdate(
  learnerRating: number,
  questionRating: number,
  score: number,
  learnerAttempts: number,
  questionAttempts = 20,
): { learner: number; question: number; expected: number } {
  const expected = expectedScore(learnerRating, questionRating);
  const delta = score - expected;
  return {
    learner: learnerRating + kFactor(learnerAttempts) * delta,
    question: questionRating - kFactor(questionAttempts) * 0.5 * delta,
    expected,
  };
}

/** Map a 1..5 difficulty level to an initial question rating. */
export const ratingForDifficulty = (difficulty: number) => BASE_RATING + (difficulty - 3) * 150;
