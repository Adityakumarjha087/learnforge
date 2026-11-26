/* eslint-disable no-console */
/**
 * Seeds realistic demo data: users for every role, three published courses (two hand-authored, one
 * generated from uploaded notes), judged quizzes, flashcards, coding exercises and simulated learner
 * activity (quiz attempts, reviews, XP, streaks, battles) so every screen has data immediately.
 *
 * Usage: npm run seed            (no-op if demo data already exists)
 *        npm run seed -- --reset (wipe all LearnForge tables first)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { AiService, setAiServiceForTests } from "../src/ai";
import { FakeLLM } from "../src/ai/providers/fake";
import { CODE_BANK } from "../src/ai/providers/fake/knowledge";
import type { AuthUser } from "../src/auth/tokens";
import { awardXp } from "../src/gamification/service";
import { createRng } from "../src/lib/rng";
import { prisma } from "../src/lib/prisma";
import { indexText } from "../src/rag/store";
import { persistCourse } from "../src/services/course";
import { generateFlashcardsForCourse, reviewCard } from "../src/services/flashcard";
import { generateQuiz, getQuiz, submitQuiz } from "../src/services/quiz";
import { fakeCourse } from "../src/ai/providers/fake/course";
import { JS_COURSE, LINALG_COURSE } from "./seed-data/courses";

const here = dirname(fileURLToPath(import.meta.url));
export const DEMO_PASSWORD = "Password123!";

const LEARNERS = [
  { email: "alex@learnforge.dev", name: "Alex Rivera", skill: 0.75 },
  { email: "priya@learnforge.dev", name: "Priya Patel", skill: 0.9 },
  { email: "sam@learnforge.dev", name: "Sam Okafor", skill: 0.55 },
  { email: "jordan@learnforge.dev", name: "Jordan Kim", skill: 0.65 },
  { email: "emma@learnforge.dev", name: "Emma Novak", skill: 0.8 },
  { email: "omar@learnforge.dev", name: "Omar Haddad", skill: 0.45 },
  { email: "li@learnforge.dev", name: "Li Wei", skill: 0.85 },
  { email: "noah@learnforge.dev", name: "Noah Schmidt", skill: 0.6 },
];

async function reset() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

const toAuth = (u: { id: string; email: string; name: string; role: AuthUser["role"] }): AuthUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export async function seed(opts: { reset?: boolean; quiet?: boolean } = {}) {
  const log = (...a: unknown[]) => !opts.quiet && console.log(...a);
  if (opts.reset) await reset();
  if (await prisma.user.findUnique({ where: { email: "admin@learnforge.dev" } })) {
    log("Seed data already present - skipping (use --reset to reseed).");
    return;
  }
  // Seeding is always offline and deterministic, regardless of the configured provider.
  setAiServiceForTests(new AiService(new FakeLLM({ errorRate: 0.15, streamDelayMs: 0 })));
  const started = Date.now();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const admin = await prisma.user.create({ data: { email: "admin@learnforge.dev", name: "Ada Admin", role: "ADMIN", passwordHash } });
  const maya = await prisma.user.create({ data: { email: "maya@learnforge.dev", name: "Dr. Maya Chen", role: "INSTRUCTOR", passwordHash } });
  const learners = [];
  for (const l of LEARNERS) learners.push({ ...(await prisma.user.create({ data: { email: l.email, name: l.name, passwordHash } })), skill: l.skill });
  await prisma.subscription.create({ data: { userId: learners[1]!.id, status: "ACTIVE", provider: "mock", customerId: "mock_cus_priya", subscriptionId: "mock_sub_priya", currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) } });
  log(`users: ${2 + learners.length}`);

  // --- Courses -------------------------------------------------------------------------------
  const jsId = await persistCourse(prisma, maya.id, JS_COURSE, { topic: "JavaScript", source: "MANUAL", status: "PUBLISHED" });
  const laId = await persistCourse(prisma, maya.id, LINALG_COURSE, { topic: "Linear Algebra", source: "MANUAL", status: "PUBLISHED" });
  const notes = readFileSync(join(here, "seed-data", "photosynthesis-notes.md"), "utf8");
  const doc = await prisma.document.create({ data: { ownerId: maya.id, filename: "photosynthesis-notes.md", mimeType: "text/markdown", text: notes } });
  const bioId = await persistCourse(prisma, maya.id, fakeCourse({ topic: "Photosynthesis", level: 1, sourceText: notes, moduleCount: 2 }), {
    topic: "Photosynthesis",
    source: "UPLOAD",
    status: "PUBLISHED",
  });
  await prisma.document.update({ where: { id: doc.id }, data: { courseId: bioId } });
  await indexText(prisma, { courseId: bioId, documentId: doc.id, text: notes });
  const courseIds = [jsId, laId, bioId];
  for (const id of courseIds) await generateFlashcardsForCourse(prisma, id, 14);

  // Coding exercises for the JavaScript course.
  const jsLessons = await prisma.lesson.findMany({ where: { module: { courseId: jsId } }, orderBy: [{ module: { order: "asc" } }, { order: "asc" }] });
  const exerciseFor: Record<string, string[]> = { "Variables and Types": ["countVowels"], Functions: ["fizzBuzz"], "Arrays and Iteration": ["sumArray", "maxOf"], Recursion: ["factorial"] };
  for (const lesson of jsLessons) {
    for (const entry of exerciseFor[lesson.title] ?? []) {
      const spec = CODE_BANK.find((c) => c.entrypoint === entry)!;
      await prisma.codeExercise.create({
        data: {
          courseId: jsId,
          lessonId: lesson.id,
          title: spec.title,
          prompt: spec.prompt,
          entrypoint: spec.entrypoint,
          starterCode: spec.starterCode,
          solution: spec.solution,
          tests: spec.tests as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  // Judged quizzes: two difficulty levels per lesson (the quality gate filters hallucinated keys).
  const adminAuth = toAuth(admin);
  let generated = 0;
  let rejectedItems = 0;
  const allLessons = await prisma.lesson.findMany({ where: { module: { courseId: { in: courseIds } } }, orderBy: [{ module: { order: "asc" } }, { order: "asc" }] });
  for (const lesson of allLessons) {
    for (const difficulty of [2, 3]) {
      const res = await generateQuiz(prisma, adminAuth, lesson.id, { difficulty, count: 5 });
      generated++;
      rejectedItems += res.report.rejected.length;
    }
  }
  await prisma.quiz.updateMany({ where: { createdById: admin.id }, data: { createdById: maya.id } });
  await prisma.usageRecord.deleteMany({});
  log(`courses: 3, lessons: ${allLessons.length}, quizzes: ${generated} (judge rejected ${rejectedItems} items)`);

  // --- Simulated learner activity -------------------------------------------------------------
  const quizzes = await prisma.quiz.findMany({ where: { status: "PUBLISHED" }, include: { questions: true }, orderBy: { createdAt: "asc" } });
  for (const [i, l] of learners.entries()) {
    const rng = createRng(`learner:${l.email}`);
    const auth = toAuth(l);
    const myCourses = i === 0 ? [jsId, laId] : courseIds.filter(() => rng() < 0.75);
    if (myCourses.length === 0) myCourses.push(jsId);
    for (const courseId of myCourses) {
      await prisma.enrollment.create({ data: { userId: l.id, courseId } });
      const lessons = allLessons.filter((x) => quizzes.some((q) => q.courseId === courseId && q.lessonId === x.id));
      const reach = Math.max(1, Math.round(lessons.length * (0.3 + rng() * 0.7)));
      for (const lesson of lessons.slice(0, reach)) {
        await prisma.lessonProgress.create({ data: { userId: l.id, lessonId: lesson.id, completedAt: new Date(Date.now() - Math.floor(rng() * 6) * 86_400_000) } });
        await awardXp(prisma, l.id, 20, "lesson-complete", new Date(Date.now() - Math.floor(rng() * 6) * 86_400_000));
        const quiz = quizzes.find((q) => q.lessonId === lesson.id && q.difficulty === 2);
        if (!quiz || (i === 0 && lesson === lessons[reach - 1])) continue;
        const pub = await getQuiz(prisma, auth, quiz.id);
        const answers = pub.questions.map((q) => {
          const full = quiz.questions.find((x) => x.id === q.id)!;
          const right = rng() < l.skill;
          if (q.type === "CODE") return { questionId: q.id, answer: right ? full.answer : q.code?.starterCode ?? "" };
          if (q.type === "SHORT_ANSWER") return { questionId: q.id, answer: right ? full.answer : "I am not sure." };
          const wrong = q.options.find((o) => o.toLowerCase() !== full.answer.toLowerCase()) ?? "";
          return { questionId: q.id, answer: right ? full.answer : wrong };
        });
        await submitQuiz(prisma, auth, quiz.id, answers);
      }
    }
    // Flashcard reviews spread over the last few days (some come due again today).
    const cards = await prisma.flashcard.findMany({ where: { courseId: { in: myCourses } }, take: 10 + Math.floor(rng() * 10) });
    await prisma.reviewCard.createMany({ data: cards.map((c) => ({ userId: l.id, flashcardId: c.id, createdAt: new Date(Date.now() - 5 * 86_400_000) })) });
    for (const c of cards) {
      const daysAgo = 1 + Math.floor(rng() * 4);
      const rating = (rng() < l.skill ? 3 : rng() < 0.5 ? 2 : 1) as 1 | 2 | 3;
      await reviewCard(prisma, auth, c.id, rating, new Date(Date.now() - daysAgo * 86_400_000));
    }
    const streak = 1 + Math.floor(rng() * 9);
    await prisma.user.update({ where: { id: l.id }, data: { streakDays: streak, longestStreak: { set: streak }, lastActiveAt: new Date(Date.now() - 86_400_000) } });
  }

  // A few completed battles for history and leaderboard flavour.
  const qids = quizzes.flatMap((q) => q.questions.filter((x) => x.type === "MCQ" || x.type === "TRUE_FALSE").map((x) => x.id)).slice(0, 5);
  const battlePairs: [number, number, number, number][] = [
    [1, 2, 620, 410],
    [0, 3, 540, 560],
    [4, 5, 700, 300],
  ];
  for (const [a, b, sa, sb] of battlePairs) {
    const pa = learners[a]!;
    const pb = learners[b]!;
    await prisma.battle.create({
      data: { playerAId: pa.id, playerBId: pb.id, scoreA: sa, scoreB: sb, winnerId: sa > sb ? pa.id : pb.id, status: "FINISHED", questions: qids, endedAt: new Date(), courseId: jsId },
    });
    await awardXp(prisma, sa > sb ? pa.id : pb.id, 50, "battle-win");
  }
  await prisma.battle.create({ data: { playerAId: learners[0]!.id, vsBot: true, scoreA: 480, scoreB: 350, winnerId: learners[0]!.id, status: "FINISHED", questions: qids, endedAt: new Date() } });

  // Make some of Alex's cards due now so the review queue is populated on first login.
  await prisma.reviewCard.updateMany({ where: { userId: learners[0]!.id }, data: { due: new Date(Date.now() - 60_000) } });
  await prisma.usageRecord.deleteMany({});
  setAiServiceForTests(undefined);
  log(`seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  log(`demo logins (password ${DEMO_PASSWORD}): alex@learnforge.dev (learner), maya@learnforge.dev (instructor), admin@learnforge.dev (admin)`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain || process.argv[1]?.endsWith("seed.js")) {
  seed({ reset: process.argv.includes("--reset") })
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
