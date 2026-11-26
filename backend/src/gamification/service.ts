import type { Db } from "../lib/prisma";
import { BADGES, earnedBadges, levelProgress, nextStreak } from "./rules";

export interface XpAward {
  xp: number;
  total: number;
  newBadges: string[];
  streak: number;
}

/** Awards XP, updates the daily streak and grants any newly earned badges. */
export async function awardXp(db: Db, userId: string, amount: number, reason: string, now = new Date()): Promise<XpAward> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const streak = nextStreak(user.lastActiveAt, user.streakDays, now);
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      xp: { increment: Math.max(0, amount) },
      streakDays: streak,
      longestStreak: Math.max(user.longestStreak, streak),
      lastActiveAt: now,
      ...(amount > 0 ? { xpEvents: { create: { amount, reason, createdAt: now } } } : {}),
    },
  });
  const newBadges = await syncBadges(db, userId);
  return { xp: amount, total: updated.xp, newBadges, streak };
}

export async function syncBadges(db: Db, userId: string): Promise<string[]> {
  const [user, lessonsCompleted, perfectQuizzes, reviews, exercisesPassed, battleWins, coursesCreated, owned] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true, streakDays: true, longestStreak: true } }),
    db.lessonProgress.count({ where: { userId } }),
    db.quizAttempt.count({ where: { userId, score: { gte: 0.999 }, completedAt: { not: null } } }),
    db.reviewLog.count({ where: { userId } }),
    db.codeSubmission.count({ where: { userId, passed: true } }),
    db.battle.count({ where: { winnerId: userId } }),
    db.course.count({ where: { authorId: userId } }),
    db.userBadge.findMany({ where: { userId }, select: { badgeKey: true } }),
  ]);
  const earned = earnedBadges({
    lessonsCompleted,
    perfectQuizzes,
    streak: Math.max(user.streakDays, user.longestStreak),
    reviews,
    exercisesPassed,
    battleWins,
    xp: user.xp,
    coursesCreated,
  });
  const have = new Set(owned.map((b) => b.badgeKey));
  const fresh = earned.filter((k) => !have.has(k));
  if (fresh.length) await db.userBadge.createMany({ data: fresh.map((badgeKey) => ({ userId, badgeKey })), skipDuplicates: true });
  return fresh;
}

export async function profile(db: Db, userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, role: true, xp: true, streakDays: true, longestStreak: true, createdAt: true },
  });
  const badges = await db.userBadge.findMany({ where: { userId }, orderBy: { awardedAt: "asc" } });
  const owned = new Map(badges.map((b) => [b.badgeKey, b.awardedAt]));
  const since = new Date(Date.now() - 7 * 86_400_000);
  const weekly = await db.xpEvent.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { amount: true } });
  return {
    ...user,
    level: levelProgress(user.xp),
    weeklyXp: weekly._sum.amount ?? 0,
    badges: BADGES.map((b) => ({ ...b, earned: owned.has(b.key), awardedAt: owned.get(b.key) ?? null })),
  };
}

export async function leaderboard(db: Db, period: "week" | "all", limit = 20) {
  if (period === "all") {
    const users = await db.user.findMany({ orderBy: [{ xp: "desc" }, { createdAt: "asc" }], take: limit, select: { id: true, name: true, image: true, xp: true, streakDays: true } });
    return users.map((u, i) => ({ rank: i + 1, ...u, score: u.xp, level: levelProgress(u.xp).level }));
  }
  const since = new Date(Date.now() - 7 * 86_400_000);
  const grouped = await db.xpEvent.groupBy({ by: ["userId"], where: { createdAt: { gte: since } }, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } }, take: limit });
  const users = await db.user.findMany({ where: { id: { in: grouped.map((g) => g.userId) } }, select: { id: true, name: true, image: true, xp: true, streakDays: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return grouped
    .filter((g) => byId.has(g.userId))
    .map((g, i) => {
      const u = byId.get(g.userId)!;
      return { rank: i + 1, ...u, score: g._sum.amount ?? 0, level: levelProgress(u.xp).level };
    });
}
