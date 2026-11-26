import { env } from "../config/env";
import { AppError } from "../lib/errors";
import type { Db } from "../lib/prisma";
import { subscriptionState } from "../billing/service";
import type { AuthUser } from "../auth/tokens";

export type UsageKind = "course" | "quiz" | "flashcards" | "tutor";
const GENERATION_KINDS: UsageKind[] = ["course", "quiz", "flashcards"];
const FREE_TUTOR_PER_DAY = 40;

const startOfMonth = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const startOfDay = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function usageSummary(db: Db, userId: string) {
  const [sub, generations, tutorToday] = await Promise.all([
    subscriptionState(db, userId),
    db.usageRecord.count({ where: { userId, kind: { in: GENERATION_KINDS }, createdAt: { gte: startOfMonth() } } }),
    db.usageRecord.count({ where: { userId, kind: "tutor", createdAt: { gte: startOfDay() } } }),
  ]);
  const limit = sub.pro ? env().PRO_GENERATIONS_PER_MONTH : env().FREE_GENERATIONS_PER_MONTH;
  return {
    plan: sub.pro ? ("PRO" as const) : ("FREE" as const),
    generations: { used: generations, limit, remaining: Math.max(0, limit - generations) },
    tutor: { usedToday: tutorToday, limitPerDay: sub.pro ? null : FREE_TUTOR_PER_DAY },
  };
}

/** Enforces plan limits before an AI generation; admins are exempt. */
export async function assertQuota(db: Db, user: AuthUser, kind: UsageKind): Promise<void> {
  if (user.role === "ADMIN") return;
  const s = await usageSummary(db, user.id);
  if (kind === "tutor") {
    if (s.tutor.limitPerDay !== null && s.tutor.usedToday >= s.tutor.limitPerDay) {
      throw new AppError("PAYMENT_REQUIRED", `Free plan tutor limit reached (${s.tutor.limitPerDay}/day). Upgrade to Pro for unlimited tutoring.`);
    }
    return;
  }
  if (s.generations.remaining <= 0) {
    throw new AppError(
      "PAYMENT_REQUIRED",
      `You've used all ${s.generations.limit} AI generations on the ${s.plan} plan this month.${s.plan === "FREE" ? " Upgrade to Pro for more." : ""}`,
    );
  }
}

export async function recordUsage(db: Db, userId: string, kind: UsageKind): Promise<void> {
  await db.usageRecord.create({ data: { userId, kind } });
}
