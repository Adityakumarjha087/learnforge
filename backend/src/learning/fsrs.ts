/**
 * FSRS-4.5 (Free Spaced Repetition Scheduler) - a pure, dependency-free implementation.
 *
 * Memory model (DSR):
 *   R(t, S) = (1 + F * t / S) ^ DECAY            retrievability after t days with stability S
 *   I(r, S) = S / F * (r ^ (1 / DECAY) - 1)      interval that yields target retention r
 * with DECAY = -0.5 and F = 19/81 so that R(S, S) = 0.9.
 *
 * Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 */
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type Rating = (typeof Rating)[keyof typeof Rating];

export type CardState = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";

export interface SrsCard {
  state: CardState;
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  scheduledDays: number;
  lastReview: Date | null;
}

export interface FsrsParams {
  w: readonly number[];
  requestRetention: number;
  maximumInterval: number;
  /** Minutes until a card in (re)learning is shown again, indexed by rating (Again, Hard). */
  learningStepsMin: { again: number; hard: number; good: number };
  relearningStepMin: number;
}

export const DEFAULT_W = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975,
  2.2042, 0.2407, 2.9466,
] as const;

export const DEFAULT_PARAMS: FsrsParams = {
  w: DEFAULT_W,
  requestRetention: 0.9,
  maximumInterval: 36500,
  learningStepsMin: { again: 1, hard: 5, good: 10 },
  relearningStepMin: 10,
};

const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const w = (p: FsrsParams, i: number): number => p.w[i] ?? 0;

export function newCard(now: Date = new Date()): SrsCard {
  return { state: "NEW", due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, scheduledDays: 0, lastReview: null };
}

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

export function nextInterval(stability: number, p: FsrsParams = DEFAULT_PARAMS): number {
  const raw = (stability / FACTOR) * (Math.pow(p.requestRetention, 1 / DECAY) - 1);
  return clamp(Math.round(raw), 1, p.maximumInterval);
}

export function initStability(rating: Rating, p: FsrsParams = DEFAULT_PARAMS): number {
  return Math.max(w(p, rating - 1), 0.1);
}

export function initDifficulty(rating: Rating, p: FsrsParams = DEFAULT_PARAMS): number {
  return clamp(w(p, 4) - (rating - 3) * w(p, 5), 1, 10);
}

export function nextDifficulty(d: number, rating: Rating, p: FsrsParams = DEFAULT_PARAMS): number {
  const delta = d - w(p, 6) * (rating - 3);
  // Mean reversion towards the initial difficulty of a "Good" answer keeps D from drifting to the bounds.
  const reverted = w(p, 7) * initDifficulty(Rating.Good, p) + (1 - w(p, 7)) * delta;
  return clamp(reverted, 1, 10);
}

export function recallStability(d: number, s: number, r: number, rating: Rating, p: FsrsParams = DEFAULT_PARAMS): number {
  const hardPenalty = rating === Rating.Hard ? w(p, 15) : 1;
  const easyBonus = rating === Rating.Easy ? w(p, 16) : 1;
  return (
    s *
    (1 +
      Math.exp(w(p, 8)) *
        (11 - d) *
        Math.pow(s, -w(p, 9)) *
        (Math.exp((1 - r) * w(p, 10)) - 1) *
        hardPenalty *
        easyBonus)
  );
}

export function forgetStability(d: number, s: number, r: number, p: FsrsParams = DEFAULT_PARAMS): number {
  const sf = w(p, 11) * Math.pow(d, -w(p, 12)) * (Math.pow(s + 1, w(p, 13)) - 1) * Math.exp((1 - r) * w(p, 14));
  // A lapse can never increase stability.
  return Math.min(sf, s);
}

export interface ReviewOutcome {
  card: SrsCard;
  log: { rating: Rating; state: CardState; elapsedDays: number; scheduledDays: number; reviewedAt: Date };
}

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * MIN_MS);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

/** Apply a review with the given rating at time `now` and return the new card state + review log. */
export function review(card: SrsCard, rating: Rating, now: Date = new Date(), p: FsrsParams = DEFAULT_PARAMS): ReviewOutcome {
  const elapsedDays = card.lastReview ? Math.max(0, (now.getTime() - card.lastReview.getTime()) / DAY_MS) : 0;
  const next: SrsCard = { ...card, reps: card.reps + 1, lastReview: now };

  const graduate = (stability: number, bonusDays = 0) => {
    const days = Math.min(p.maximumInterval, nextInterval(stability, p) + bonusDays);
    next.state = "REVIEW";
    next.scheduledDays = days;
    next.due = addDays(now, days);
  };
  const step = (state: CardState, minutes: number) => {
    next.state = state;
    next.scheduledDays = 0;
    next.due = addMinutes(now, minutes);
  };

  switch (card.state) {
    case "NEW": {
      next.stability = initStability(rating, p);
      next.difficulty = initDifficulty(rating, p);
      if (rating === Rating.Again) step("LEARNING", p.learningStepsMin.again);
      else if (rating === Rating.Hard) step("LEARNING", p.learningStepsMin.hard);
      else if (rating === Rating.Good) step("LEARNING", p.learningStepsMin.good);
      else graduate(next.stability);
      break;
    }
    case "LEARNING":
    case "RELEARNING": {
      next.difficulty = nextDifficulty(card.difficulty, rating, p);
      if (rating === Rating.Again) {
        next.stability = Math.max(0.1, Math.min(card.stability, initStability(Rating.Again, p)));
        step(card.state, p.learningStepsMin.hard);
      } else if (rating === Rating.Hard) {
        step(card.state, p.learningStepsMin.good);
      } else {
        next.stability = Math.max(card.stability, initStability(rating, p));
        graduate(next.stability, rating === Rating.Easy ? 1 : 0);
      }
      break;
    }
    case "REVIEW": {
      const r = retrievability(elapsedDays, card.stability);
      next.difficulty = nextDifficulty(card.difficulty, rating, p);
      if (rating === Rating.Again) {
        next.stability = forgetStability(card.difficulty, card.stability, r, p);
        next.lapses = card.lapses + 1;
        step("RELEARNING", p.relearningStepMin);
      } else {
        next.stability = recallStability(card.difficulty, card.stability, r, rating, p);
        graduate(next.stability);
      }
      break;
    }
  }

  return {
    card: next,
    log: { rating, state: card.state, elapsedDays, scheduledDays: next.scheduledDays, reviewedAt: now },
  };
}

/** Preview the interval (in days, 0 = same day) each rating would produce - used for button labels. */
export function previewIntervals(card: SrsCard, now: Date = new Date(), p: FsrsParams = DEFAULT_PARAMS) {
  const out = {} as Record<"again" | "hard" | "good" | "easy", { days: number; due: Date }>;
  (
    [
      ["again", Rating.Again],
      ["hard", Rating.Hard],
      ["good", Rating.Good],
      ["easy", Rating.Easy],
    ] as const
  ).forEach(([k, rating]) => {
    const { card: c } = review(card, rating, now, p);
    out[k] = { days: c.scheduledDays, due: c.due };
  });
  return out;
}
