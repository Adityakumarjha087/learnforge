import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  forgetStability,
  initDifficulty,
  initStability,
  newCard,
  nextDifficulty,
  nextInterval,
  previewIntervals,
  Rating,
  recallStability,
  retrievability,
  review,
  type SrsCard,
} from "../../src/learning/fsrs";

const DAY = 86_400_000;
const t0 = new Date("2026-01-01T09:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

function graduate(): SrsCard {
  const learning = review(newCard(t0), Rating.Good, t0).card;
  return review(learning, Rating.Good, new Date(t0.getTime() + 10 * 60_000)).card;
}

describe("FSRS memory model", () => {
  it("retrievability is 1 at t=0, 0.9 at t=S and decays monotonically", () => {
    expect(retrievability(0, 5)).toBeCloseTo(1, 6);
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 6);
    expect(retrievability(10, 5)).toBeLessThan(retrievability(5, 5));
    expect(retrievability(3, 0)).toBe(0);
  });

  it("interval at 90% target retention equals stability (clamped to >= 1 day)", () => {
    expect(nextInterval(10)).toBe(10);
    expect(nextInterval(0.2)).toBe(1);
    expect(nextInterval(1e9)).toBe(DEFAULT_PARAMS.maximumInterval);
    expect(nextInterval(10, { ...DEFAULT_PARAMS, requestRetention: 0.8 })).toBeGreaterThan(10);
  });

  it("initial stability/difficulty follow the default weights and grade ordering", () => {
    expect(initStability(Rating.Again)).toBeCloseTo(0.4072);
    expect(initStability(Rating.Easy)).toBeCloseTo(15.4722);
    expect(initDifficulty(Rating.Again)).toBeGreaterThan(initDifficulty(Rating.Easy));
    expect(initDifficulty(Rating.Good)).toBeCloseTo(7.2102);
  });

  it("difficulty stays within [1, 10] and decreases on easy answers", () => {
    let d = 5;
    for (let i = 0; i < 50; i++) d = nextDifficulty(d, Rating.Easy);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(nextDifficulty(5, Rating.Easy)).toBeLessThan(5);
    let h = 5;
    for (let i = 0; i < 50; i++) h = nextDifficulty(h, Rating.Again);
    expect(h).toBeLessThanOrEqual(10);
  });

  it("successful recall increases stability more when retrievability is low", () => {
    const sHigh = recallStability(5, 10, 0.95, Rating.Good);
    const sLow = recallStability(5, 10, 0.7, Rating.Good);
    expect(sHigh).toBeGreaterThan(10);
    expect(sLow).toBeGreaterThan(sHigh);
    expect(recallStability(5, 10, 0.8, Rating.Hard)).toBeLessThan(recallStability(5, 10, 0.8, Rating.Easy));
  });

  it("a lapse never increases stability", () => {
    expect(forgetStability(5, 20, 0.9)).toBeLessThan(20);
    expect(forgetStability(9, 0.3, 0.1)).toBeLessThanOrEqual(0.3);
  });
});

describe("FSRS scheduler", () => {
  it("new card: Again/Hard/Good stay in learning with minute steps, Easy graduates", () => {
    const c = newCard(t0);
    const again = review(c, Rating.Again, t0).card;
    expect(again.state).toBe("LEARNING");
    expect(again.due.getTime() - t0.getTime()).toBe(60_000);
    expect(review(c, Rating.Good, t0).card.due.getTime() - t0.getTime()).toBe(10 * 60_000);
    const easy = review(c, Rating.Easy, t0);
    expect(easy.card.state).toBe("REVIEW");
    expect(easy.card.scheduledDays).toBe(15);
    expect(easy.log.state).toBe("NEW");
    expect(easy.card.reps).toBe(1);
  });

  it("learning card graduates on Good and repeats on Again/Hard", () => {
    const learning = review(newCard(t0), Rating.Hard, t0).card;
    expect(review(learning, Rating.Again, t0).card.state).toBe("LEARNING");
    expect(review(learning, Rating.Hard, t0).card.state).toBe("LEARNING");
    const grad = review(learning, Rating.Good, t0).card;
    expect(grad.state).toBe("REVIEW");
    expect(grad.scheduledDays).toBeGreaterThanOrEqual(1);
    const easy = review(learning, Rating.Easy, t0).card;
    expect(easy.scheduledDays).toBeGreaterThan(grad.scheduledDays);
  });

  it("review intervals grow across successful reviews", () => {
    let card = graduate();
    const intervals: number[] = [card.scheduledDays];
    let now = card.due;
    for (let i = 0; i < 4; i++) {
      card = review(card, Rating.Good, now).card;
      intervals.push(card.scheduledDays);
      now = card.due;
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
  });

  it("forgetting a review card moves it to relearning and counts a lapse", () => {
    const card = graduate();
    const out = review(card, Rating.Again, at(card.scheduledDays + 3));
    expect(out.card.state).toBe("RELEARNING");
    expect(out.card.lapses).toBe(1);
    expect(out.card.stability).toBeLessThan(card.stability);
    expect(out.log.elapsedDays).toBeGreaterThan(card.scheduledDays);
    const back = review(out.card, Rating.Good, new Date(out.card.due.getTime()));
    expect(back.card.state).toBe("REVIEW");
  });

  it("previews are ordered again <= hard <= good <= easy for review cards", () => {
    const card = graduate();
    const p = previewIntervals(card, card.due);
    expect(p.again.days).toBe(0);
    expect(p.hard.days).toBeLessThanOrEqual(p.good.days);
    expect(p.good.days).toBeLessThanOrEqual(p.easy.days);
  });
});
