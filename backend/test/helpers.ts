import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { AiService, setAiServiceForTests } from "../src/ai";
import { FakeLLM } from "../src/ai/providers/fake";
import type { AuthUser } from "../src/auth/tokens";
import { buildApp } from "../src/http/app";
import { prisma } from "../src/lib/prisma";
import { persistCourse } from "../src/services/course";
import { createCaller } from "../src/trpc/router";
import { JS_COURSE } from "../prisma/seed-data/courses";

export { prisma };

export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export function useFakeAi(errorRate = 0): FakeLLM {
  const fake = new FakeLLM({ errorRate, streamDelayMs: 0 });
  setAiServiceForTests(new AiService(fake));
  return fake;
}

let counter = 0;
export async function createUser(role: AuthUser["role"] = "LEARNER", password = "Password123!"): Promise<AuthUser> {
  counter++;
  const u = await prisma.user.create({
    data: { email: `user${counter}-${Date.now()}@test.dev`, name: `User ${counter}`, role, passwordHash: await bcrypt.hash(password, 4) },
  });
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export const caller = (user: AuthUser | null) => createCaller({ db: prisma, user, ip: "127.0.0.1" });

/** A published JavaScript course authored by an instructor. */
export async function seedCourse(author?: AuthUser) {
  const instructor = author ?? (await createUser("INSTRUCTOR"));
  const courseId = await persistCourse(prisma, instructor.id, JS_COURSE, { topic: "JavaScript", source: "MANUAL", status: "PUBLISHED" });
  const lessons = await prisma.lesson.findMany({ where: { module: { courseId } }, orderBy: [{ module: { order: "asc" } }, { order: "asc" }] });
  return { instructor, courseId, lessons };
}

let app: FastifyInstance | undefined;
export async function getApp(): Promise<FastifyInstance> {
  app ??= await buildApp();
  await app.ready();
  return app;
}

export function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}
