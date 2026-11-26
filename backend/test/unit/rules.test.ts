import { describe, expect, it } from "vitest";
import { fromStripeStatus, INITIAL_STATE, isPro, transition, type SubState } from "../../src/billing/state-machine";
import { BADGES, earnedBadges, levelForXp, levelProgress, nextStreak, xpForLevel } from "../../src/gamification/rules";

describe("gamification rules", () => {
  it("levels follow a quadratic curve", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(400)).toBe(3);
    expect(xpForLevel(3)).toBe(400);
    expect(levelProgress(250)).toEqual({ level: 2, current: 150, needed: 300, pct: 50 });
    expect(levelForXp(-5)).toBe(1);
  });

  it("streaks increment on consecutive days and reset after a gap", () => {
    const d = (s: string) => new Date(s);
    expect(nextStreak(null, 0, d("2026-03-02T10:00:00Z"))).toBe(1);
    expect(nextStreak(d("2026-03-02T08:00:00Z"), 4, d("2026-03-02T22:00:00Z"))).toBe(4);
    expect(nextStreak(d("2026-03-01T23:00:00Z"), 4, d("2026-03-02T01:00:00Z"))).toBe(5);
    expect(nextStreak(d("2026-02-26T10:00:00Z"), 9, d("2026-03-02T10:00:00Z"))).toBe(1);
  });

  it("awards badges from stats", () => {
    const none = earnedBadges({ lessonsCompleted: 0, perfectQuizzes: 0, streak: 0, reviews: 0, exercisesPassed: 0, battleWins: 0, xp: 0, coursesCreated: 0 });
    expect(none).toEqual([]);
    const all = earnedBadges({ lessonsCompleted: 1, perfectQuizzes: 1, streak: 7, reviews: 50, exercisesPassed: 1, battleWins: 1, xp: 1000, coursesCreated: 1 });
    expect(all.sort()).toEqual(BADGES.map((b) => b.key).sort());
  });
});

describe("subscription state machine", () => {
  const end = new Date(Date.now() + 10 * 86_400_000);
  const active: SubState = { status: "ACTIVE", currentPeriodEnd: end, cancelAtPeriodEnd: false };

  it("checkout activates (or trials) a subscription", () => {
    expect(transition(INITIAL_STATE, { type: "checkout.completed", periodEnd: end })).toEqual(active);
    expect(transition(INITIAL_STATE, { type: "checkout.completed", periodEnd: end, trial: true }).status).toBe("TRIALING");
  });

  it("payment failure moves to PAST_DUE and a paid invoice recovers", () => {
    const pastDue = transition(active, { type: "invoice.payment_failed" });
    expect(pastDue.status).toBe("PAST_DUE");
    expect(isPro(pastDue)).toBe(true); // dunning grace period
    expect(transition(pastDue, { type: "invoice.paid", periodEnd: null }).status).toBe("ACTIVE");
  });

  it("ignores meaningless signals", () => {
    expect(transition(INITIAL_STATE, { type: "invoice.payment_failed" })).toBe(INITIAL_STATE);
    expect(transition(INITIAL_STATE, { type: "invoice.paid", periodEnd: end })).toBe(INITIAL_STATE);
    expect(transition(INITIAL_STATE, { type: "subscription.deleted" })).toBe(INITIAL_STATE);
    const canceled: SubState = { ...active, status: "CANCELED" };
    expect(transition(canceled, { type: "subscription.updated", status: "PAST_DUE", periodEnd: end, cancelAtPeriodEnd: false })).toBe(canceled);
  });

  it("cancel at period end keeps access until deletion", () => {
    const pending = transition(active, { type: "subscription.updated", status: "ACTIVE", periodEnd: end, cancelAtPeriodEnd: true });
    expect(pending.cancelAtPeriodEnd).toBe(true);
    expect(isPro(pending)).toBe(true);
    const gone = transition(pending, { type: "subscription.deleted" });
    expect(gone.status).toBe("CANCELED");
    expect(isPro(gone)).toBe(false);
    expect(isPro({ ...pending, currentPeriodEnd: new Date(Date.now() - 1000) })).toBe(false);
  });

  it("PAST_DUE loses access after the grace window", () => {
    expect(isPro({ status: "PAST_DUE", currentPeriodEnd: new Date(Date.now() - 8 * 86_400_000), cancelAtPeriodEnd: false })).toBe(false);
    expect(isPro(INITIAL_STATE)).toBe(false);
  });

  it("maps Stripe statuses", () => {
    expect(["trialing", "active", "past_due", "unpaid", "canceled", "incomplete_expired", "paused"].map(fromStripeStatus)).toEqual([
      "TRIALING",
      "ACTIVE",
      "PAST_DUE",
      "PAST_DUE",
      "CANCELED",
      "CANCELED",
      "NONE",
    ]);
  });
});
