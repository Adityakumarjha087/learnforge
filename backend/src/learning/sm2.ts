/**
 * SM-2 (SuperMemo 2) - the classic baseline scheduler, kept alongside FSRS for comparison
 * and selectable with SRS_ALGORITHM=sm2.
 */
export interface Sm2State {
  repetitions: number;
  easiness: number;
  intervalDays: number;
}

export const SM2_INITIAL: Sm2State = { repetitions: 0, easiness: 2.5, intervalDays: 0 };

/** @param quality 0..5 recall quality (>= 3 is a successful recall). */
export function sm2(state: Sm2State, quality: number): Sm2State {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) throw new RangeError("quality must be an integer 0..5");
  const easiness = Math.max(1.3, state.easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  if (quality < 3) return { repetitions: 0, easiness, intervalDays: 1 };
  const repetitions = state.repetitions + 1;
  const intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(state.intervalDays * easiness);
  return { repetitions, easiness, intervalDays };
}

/** Map the four-button FSRS rating (1..4) onto SM-2 quality. */
export function ratingToQuality(rating: 1 | 2 | 3 | 4): number {
  return { 1: 1, 2: 3, 3: 4, 4: 5 }[rating];
}
