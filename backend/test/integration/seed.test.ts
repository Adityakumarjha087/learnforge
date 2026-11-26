import { describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed";
import { prisma, resetDb } from "../helpers";

describe("seed script", () => {
  it("creates a complete, usable demo dataset and is idempotent", async () => {
    await resetDb();
    await seed({ quiet: true });
    expect(await prisma.user.count()).toBe(10);
    expect(await prisma.course.count({ where: { status: "PUBLISHED" } })).toBe(3);
    expect(await prisma.quiz.count({ where: { status: "PUBLISHED" } })).toBeGreaterThanOrEqual(20);
    expect(await prisma.codeExercise.count()).toBeGreaterThanOrEqual(5);
    expect(await prisma.quizAttempt.count()).toBeGreaterThan(10);
    const alex = await prisma.user.findUniqueOrThrow({ where: { email: "alex@learnforge.dev" } });
    expect(await prisma.reviewCard.count({ where: { userId: alex.id, due: { lte: new Date() } } })).toBeGreaterThan(0);
    await seed({ quiet: true });
    expect(await prisma.user.count()).toBe(10);
  }, 120_000);
});
