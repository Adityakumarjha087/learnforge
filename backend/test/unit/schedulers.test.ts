import { describe, expect, it } from "vitest";
import { bktUpdate, DEFAULT_BKT, guessFor, isMastered, pCorrect } from "../../src/learning/bkt";
import { difficultyLabel, recommendNext, selectByElo, targetDifficulty } from "../../src/learning/adaptive";
import { eloUpdate, expectedScore, kFactor, ratingForDifficulty } from "../../src/learning/elo";
import { ratingToQuality, sm2, SM2_INITIAL } from "../../src/learning/sm2";

describe("SM-2", () => {
  it("produces the canonical 1, 6, round(6*EF) interval sequence", () => {
    const a = sm2(SM2_INITIAL, 5);
    const b = sm2(a, 5);
    const c = sm2(b, 5);
    expect([a.intervalDays, b.intervalDays]).toEqual([1, 6]);
    expect(c.intervalDays).toBe(Math.round(6 * c.easiness));
    expect(c.easiness).toBeCloseTo(2.8, 5);
  });

  it("resets repetitions on failure and floors easiness at 1.3", () => {
    let s = sm2(sm2(SM2_INITIAL, 4), 4);
    s = sm2(s, 1);
    expect(s.repetitions).toBe(0);
    expect(s.intervalDays).toBe(1);
    let e = SM2_INITIAL;
    for (let i = 0; i < 20; i++) e = sm2(e, 0);
    expect(e.easiness).toBe(1.3);
  });

  it("validates quality and maps four-button ratings", () => {
    expect(() => sm2(SM2_INITIAL, 6)).toThrow(RangeError);
    expect(() => sm2(SM2_INITIAL, 2.5)).toThrow(RangeError);
    expect([1, 2, 3, 4].map((r) => ratingToQuality(r as 1 | 2 | 3 | 4))).toEqual([1, 3, 4, 5]);
  });
});

describe("Bayesian Knowledge Tracing", () => {
  it("correct answers raise and incorrect answers lower P(known)", () => {
    expect(bktUpdate(0.3, true)).toBeGreaterThan(0.3);
    expect(bktUpdate(0.6, false)).toBeLessThan(0.6);
  });

  it("converges to mastery after a run of correct answers", () => {
    let p = DEFAULT_BKT.pInit;
    let steps = 0;
    while (!isMastered(p) && steps < 20) {
      p = bktUpdate(p, true);
      steps++;
    }
    expect(isMastered(p)).toBe(true);
    expect(steps).toBeLessThanOrEqual(5);
  });

  it("guessable formats provide weaker evidence", () => {
    const tf = bktUpdate(0.3, true, { ...DEFAULT_BKT, pGuess: guessFor("TRUE_FALSE") });
    const code = bktUpdate(0.3, true, { ...DEFAULT_BKT, pGuess: guessFor("CODE") });
    expect(code).toBeGreaterThan(tf);
    expect(guessFor("MCQ", 4)).toBe(0.25);
    expect(guessFor("MCQ", 1)).toBe(0.5);
    expect(guessFor("SHORT_ANSWER")).toBe(0.1);
  });

  it("predicts correctness between guess and 1-slip", () => {
    expect(pCorrect(0)).toBeCloseTo(DEFAULT_BKT.pGuess);
    expect(pCorrect(1)).toBeCloseTo(1 - DEFAULT_BKT.pSlip);
  });

  it("stays within (0,1)", () => {
    expect(bktUpdate(0.9999, true)).toBeLessThan(1);
    expect(bktUpdate(0.0001, false)).toBeGreaterThan(0);
  });
});

describe("Elo mastery", () => {
  it("expected score is 0.5 for equal ratings and symmetric", () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(1);
  });

  it("winning against a harder item gains more than against an easier one", () => {
    const hard = eloUpdate(1000, 1300, 1, 5);
    const easy = eloUpdate(1000, 700, 1, 5);
    expect(hard.learner - 1000).toBeGreaterThan(easy.learner - 1000);
    expect(hard.question).toBeLessThan(1300);
    expect(eloUpdate(1000, 1000, 0, 5).learner).toBeLessThan(1000);
  });

  it("K-factor decays with experience but has a floor", () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(40));
    expect(kFactor(10_000)).toBe(16);
    expect(ratingForDifficulty(3)).toBe(1000);
    expect(ratingForDifficulty(5)).toBe(1300);
  });
});

describe("adaptive engine", () => {
  it("maps mastery to target difficulty", () => {
    expect([0.1, 0.4, 0.6, 0.8, 0.95].map(targetDifficulty)).toEqual([1, 2, 3, 4, 5]);
    expect(difficultyLabel(3)).toBe("Medium");
    expect(difficultyLabel(99)).toBe("Medium");
  });

  it("selects items closest to the 70% success sweet spot", () => {
    const items = [{ rating: 600 }, { rating: 850 }, { rating: 1000 }, { rating: 1400 }];
    const [best] = selectByElo(items, 1000, 1);
    expect(best!.rating).toBe(850);
    expect(selectByElo(items, 1000, 3)).toHaveLength(3);
  });

  const lessons = [
    { id: "l1", order: 0, conceptId: "c1", difficulty: 1 },
    { id: "l2", order: 1, conceptId: "c2", difficulty: 2 },
    { id: "l3", order: 2, conceptId: "c3", difficulty: 3 },
  ];

  it("continues in sequence when nothing is weak", () => {
    const rec = recommendNext(lessons, new Set(["l1"]), new Map([["c1", { pKnown: 0.9, attempts: 3 }]]));
    expect(rec).toMatchObject({ lessonId: "l2", reason: "next-in-sequence" });
  });

  it("remediates the weakest completed concept first", () => {
    const mastery = new Map([
      ["c1", { pKnown: 0.35, attempts: 4 }],
      ["c2", { pKnown: 0.2, attempts: 3 }],
    ]);
    const rec = recommendNext(lessons, new Set(["l1", "l2"]), mastery);
    expect(rec).toMatchObject({ lessonId: "l2", reason: "review-weak-concept", targetDifficulty: 1 });
  });

  it("reports completion and handles empty courses", () => {
    expect(recommendNext(lessons, new Set(["l1", "l2", "l3"]), new Map())?.reason).toBe("course-complete");
    expect(recommendNext([], new Set(), new Map())).toBeNull();
  });
});
