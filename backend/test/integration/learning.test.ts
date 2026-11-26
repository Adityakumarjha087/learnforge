import { TRPCError } from "@trpc/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setEnvForTests } from "../../src/config/env";
import { setAiServiceForTests } from "../../src/ai";
import { caller, createUser, prisma, resetDb, seedCourse, useFakeAi } from "../helpers";

describe("courses, quizzes, flashcards and mastery (tRPC)", () => {
  beforeAll(async () => {
    await resetDb();
  });
  beforeEach(() => {
    useFakeAi();
  });

  it("generates a course from a topic with concepts, flashcards and RAG chunks", async () => {
    const learner = await createUser();
    const res = await caller(learner).course.generate({ topic: "Introduction to Statistics", level: 2, moduleCount: 2 });
    expect(res.award.xp).toBe(15);
    expect(res.award.newBadges).toContain("creator");
    const course = await caller(learner).course.get({ id: res.courseId });
    expect(course.status).toBe("DRAFT");
    expect(course.canEdit).toBe(true);
    expect(course.modules).toHaveLength(2);
    expect(course.recommendation?.reason).toBe("next-in-sequence");
    expect(await prisma.flashcard.count({ where: { courseId: res.courseId } })).toBeGreaterThan(3);
    const chunks = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Chunk" WHERE "courseId" = ${res.courseId} AND embedding IS NOT NULL`;
    expect(Number(chunks[0]!.n)).toBeGreaterThan(0);
    // Drafts are private; learners cannot publish.
    const other = await createUser();
    await expect(caller(other).course.get({ id: res.courseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(learner).course.publish({ id: res.courseId, published: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await caller(learner).course.mine()).authored).toHaveLength(1);
  });

  it("generates a grounded course from an uploaded document", async () => {
    const user = await createUser();
    const text = "Photosynthesis happens inside chloroplasts in plant leaves. Chlorophyll absorbs red and blue light strongly. The Calvin cycle fixes carbon dioxide into sugars using ATP. ".repeat(4);
    const doc = await prisma.document.create({ data: { ownerId: user.id, filename: "n.md", mimeType: "text/markdown", text } });
    const res = await caller(user).course.generate({ topic: "Photosynthesis", level: 1, documentId: doc.id, moduleCount: 2 });
    const course = await prisma.course.findUniqueOrThrow({ where: { id: res.courseId }, include: { concepts: true } });
    expect(course.source).toBe("UPLOAD");
    expect(course.concepts.map((c) => c.key)).toContain("photosynthesis");
    const other = await createUser();
    await expect(caller(other).course.generate({ topic: "x y z", documentId: doc.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces the free-plan generation quota and lifts it on Pro", async () => {
    const user = await createUser();
    setEnvForTests({ FREE_GENERATIONS_PER_MONTH: 1 });
    try {
      await caller(user).course.generate({ topic: "Topic One", level: 1, moduleCount: 1 });
      await expect(caller(user).course.generate({ topic: "Topic Two", level: 1, moduleCount: 1 })).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
      await caller(user).billing.mock({ action: "checkout" });
      expect((await caller(user).me.usage()).plan).toBe("PRO");
      await caller(user).course.generate({ topic: "Topic Two", level: 1, moduleCount: 1 });
    } finally {
      setEnvForTests({ FREE_GENERATIONS_PER_MONTH: 10 });
    }
  });

  it("runs the adaptive quiz loop: generate -> judge -> take -> mastery + XP", async () => {
    const { courseId, lessons, instructor } = await seedCourse();
    const learner = await createUser();
    const api = caller(learner);
    await api.course.enroll({ id: courseId });
    const lesson = lessons.find((l) => l.title === "Arrays and Iteration")!;
    const { quizId, difficulty, generated } = await api.quiz.adaptive({ lessonId: lesson.id });
    expect(generated).toBe(true);
    expect(difficulty).toBe(1); // new learner, low prior mastery
    const quiz = await api.quiz.get({ id: quizId });
    expect(quiz.status).toBe("PUBLISHED");
    expect(quiz.judgeReport).toBeNull(); // learners don't see reviewer notes
    expect(JSON.stringify(quiz.questions)).not.toContain('"answer"');

    const full = await prisma.question.findMany({ where: { quizId }, include: { exercise: true } });
    const answers = full.map((q) => ({ questionId: q.id, answer: q.type === "CODE" ? q.exercise!.solution : q.answer }));
    const result = await api.quiz.submit({ id: quizId, answers });
    expect(result.correct).toBe(result.total);
    expect(result.score).toBeCloseTo(1);
    expect(result.award.xp).toBe(result.total * 10 + 25);
    expect(result.mastery[0]!.after).toBeGreaterThan(result.mastery[0]!.before);
    expect(result.award.newBadges).toContain("quiz-ace");

    // Mastery rose, so the next adaptive quiz targets a harder level.
    const next = await api.quiz.adaptive({ lessonId: lesson.id });
    expect(next.difficulty).toBeGreaterThan(difficulty);
    const mastery = await api.mastery.course({ courseId });
    expect(mastery.find((m) => m.key === "arrays")!.attempts).toBeGreaterThan(0);

    // Wrong answers lower mastery and give feedback.
    const wrong = await api.quiz.submit({ id: quizId, answers: full.map((q) => ({ questionId: q.id, answer: "definitely wrong" })) });
    expect(wrong.correct).toBe(0);
    expect(wrong.results.every((r) => r.feedback.length > 0)).toBe(true);
    expect((await api.quiz.history()).length).toBe(2);

    // Author sees the judge report and can moderate.
    const list = await caller(instructor).quiz.forCourse({ courseId });
    expect(list[0]!.judgeReport?.generated).toBeGreaterThan(0);
    await caller(instructor).quiz.setStatus({ id: quizId, status: "REJECTED" });
    await expect(api.quiz.get({ id: quizId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.quiz.setStatus({ id: quizId, status: "PUBLISHED" })).rejects.toBeInstanceOf(TRPCError);
  });

  it("quality gate drops hallucinated items reported by the judge", async () => {
    useFakeAi(1); // every MCQ gets a wrong key
    const { lessons } = await seedCourse();
    const admin = await createUser("ADMIN");
    const res = await caller(admin).quiz.generate({ lessonId: lessons[2]!.id, difficulty: 2, count: 5 });
    expect(res.report.rejected.length).toBeGreaterThan(0);
    expect(res.report.rejected.every((r) => r.issues.some((i) => /not supported/.test(i)))).toBe(true);
    const stored = await prisma.question.count({ where: { quizId: res.quizId, type: "MCQ" } });
    expect(stored).toBe(0);
    setAiServiceForTests(undefined);
  });

  it("schedules flashcards with FSRS and feeds mastery", async () => {
    const { courseId } = await seedCourse();
    const learner = await createUser();
    const api = caller(learner);
    await api.course.enroll({ id: courseId });
    await prisma.flashcard.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ courseId, front: `Q${i}`, back: `A${i}` })) });
    const queue = await api.flashcard.queue({ courseId });
    expect(queue.algorithm).toBe("fsrs");
    expect(queue.counts.new).toBe(5);
    expect(queue.cards[0]!.intervals.easy).toBeGreaterThan(0);
    const card = queue.cards[0]!;
    const r = await api.flashcard.review({ flashcardId: card.id, rating: 4 });
    expect(r.state).toBe("REVIEW");
    expect(r.scheduledDays).toBeGreaterThanOrEqual(1);
    const again = await api.flashcard.review({ flashcardId: queue.cards[1]!.id, rating: 1 });
    expect(again.state).toBe("LEARNING");
    const after = await api.flashcard.queue({ courseId });
    expect(after.cards.map((c) => c.id)).not.toContain(card.id);
    const stats = await api.flashcard.stats();
    expect(stats.reviewedToday).toBe(2);
    expect(stats.forecast).toHaveLength(7);
    await expect(api.flashcard.review({ flashcardId: "missing", rating: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });

    process.env.SRS_ALGORITHM = "sm2";
    try {
      const sm = await api.flashcard.review({ flashcardId: queue.cards[2]!.id, rating: 3 });
      expect(sm.scheduledDays).toBe(1);
    } finally {
      delete process.env.SRS_ALGORITHM;
    }
  });

  it("lesson progress, editing, publishing, catalog and deletion", async () => {
    const { courseId, lessons, instructor } = await seedCourse();
    const learner = await createUser();
    const api = caller(learner);
    const lesson = await api.course.lesson({ id: lessons[0]!.id });
    expect(lesson.nextLessonId).toBe(lessons[1]!.id);
    expect(lesson.prevLessonId).toBeNull();
    const done = await api.course.completeLesson({ lessonId: lessons[0]!.id });
    expect(done.award?.newBadges).toContain("first-lesson");
    expect((await api.course.completeLesson({ lessonId: lessons[0]!.id })).alreadyCompleted).toBe(true);
    const mine = await api.course.mine();
    expect(mine.enrolled[0]!.completedLessons).toBe(1);

    await expect(api.course.updateLesson({ id: lessons[0]!.id, content: "hacked" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const edited = await caller(instructor).course.updateLesson({ id: lessons[0]!.id, content: "## Updated\n\nClosures capture variables from their enclosing scope." });
    expect(edited.content).toContain("Closures");
    const chunk = await prisma.chunk.findFirst({ where: { lessonId: lessons[0]!.id } });
    expect(chunk?.content).toContain("Closures");
    const added = await caller(instructor).course.addLesson({ moduleId: (await prisma.module.findFirstOrThrow({ where: { courseId } })).id, title: "Closures" });
    expect(added.order).toBe(2);
    await caller(instructor).course.update({ id: courseId, title: "JavaScript Fundamentals II" });

    const catalog = await api.course.catalog({ search: "fundamentals II" });
    expect(catalog.items.map((c) => c.id)).toContain(courseId);
    await caller(instructor).course.publish({ id: courseId, published: false });
    expect((await api.course.catalog({ search: "fundamentals II" })).items).toHaveLength(0);
    await expect(api.course.delete({ id: courseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller(instructor).course.delete({ id: courseId });
    await expect(api.course.get({ id: courseId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects unauthenticated access", async () => {
    await expect(caller(null).me.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const learner = await createUser();
    await expect(caller(learner).instructor.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
