/**
 * Bayesian Knowledge Tracing - estimates P(learner knows concept) from a sequence of observations.
 */
export interface BktParams {
  pInit: number;
  pTransit: number;
  pSlip: number;
  pGuess: number;
}

export const DEFAULT_BKT: BktParams = { pInit: 0.2, pTransit: 0.15, pSlip: 0.1, pGuess: 0.2 };

/** Guess probability depends on the question format. */
export function guessFor(type: "MCQ" | "TRUE_FALSE" | "SHORT_ANSWER" | "CODE", optionCount = 4): number {
  switch (type) {
    case "TRUE_FALSE":
      return 0.5;
    case "MCQ":
      return 1 / Math.max(2, optionCount);
    case "SHORT_ANSWER":
      return 0.1;
    case "CODE":
      return 0.05;
  }
}

/** One BKT step: Bayesian posterior given the observation, then the learning transition. */
export function bktUpdate(pKnown: number, correct: boolean, params: BktParams = DEFAULT_BKT): number {
  const { pSlip: s, pGuess: g, pTransit: t } = params;
  const posterior = correct
    ? (pKnown * (1 - s)) / (pKnown * (1 - s) + (1 - pKnown) * g)
    : (pKnown * s) / (pKnown * s + (1 - pKnown) * (1 - g));
  const next = posterior + (1 - posterior) * t;
  return Math.min(0.999, Math.max(0.001, next));
}

/** Probability the learner answers the next item correctly. */
export function pCorrect(pKnown: number, params: BktParams = DEFAULT_BKT): number {
  return pKnown * (1 - params.pSlip) + (1 - pKnown) * params.pGuess;
}

export const MASTERY_THRESHOLD = 0.85;
export const isMastered = (pKnown: number) => pKnown >= MASTERY_THRESHOLD;
