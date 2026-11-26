import type { Prisma } from "@prisma/client";
import { ai } from "../ai";
import type { CourseOutline } from "../ai/schemas";
import { hasRole, type AuthUser } from "../auth/tokens";
import { awardXp } from "../gamification/service";
import { XP } from "../gamification/rules";
import { recommendNext } from "../learning/adaptive";
import { AppError, forbidden, notFound } from "../lib/errors";
import type { Db } from "../lib/prisma";
import { randomToken } from "../lib/crypto";
import { slugify } from "../lib/text";
import { indexText, reindexLesson } from "../rag/store";
import { generateFlashcardsForCourse } from "./flashcard";
import { masteryMap } from "./mastery";
import { assertQuota, recordUsage } from "./usage";

export interface GenerateCourseInput {
  topic: string;
  level: number;
  documentId?: string;
  moduleCount?: number;
}

const canEdit = (user: AuthUser, authorId: string) => user.role === "ADMIN" || user.id === authorId;

/** Persist an AI course outline (concepts, modules, lessons) and index it for RAG. */
export async function persistCourse(
  db: Db,
  authorId: string,
  outline: CourseOutline,
  meta: { topic: string; source: "TOPIC" | "UPLOAD" | "MANUAL"; status?: "DRAFT" | "PUBLISHED" },
): Promise<string> {
  const courseId = await db.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        slug: `${slugify(outline.title)}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`,
        title: outline.title,
        description: outline.description,
        topic: meta.topic,
        level: outline.level,
        source: meta.source,
        status: meta.status ?? "DRAFT",
        publishedAt: meta.status === "PUBLISHED" ? new Date() : null,
        authorId,
      },
    });
    const conceptIds = new Map<string, string>();
    for (const c of outline.concepts) {
      if (conceptIds.has(c.key)) continue;
      const row = await tx.concept.create({ data: { courseId: course.id, key: c.key, name: c.name, description: c.description } });
      conceptIds.set(c.key, row.id);
    }
    for (const [mi, m] of outline.modules.entries()) {
      const mod = await tx.module.create({ data: { courseId: course.id, title: m.title, summary: m.summary, order: mi } });
      for (const [li, l] of m.lessons.entries()) {
        let conceptId = conceptIds.get(l.conceptKey);
        if (!conceptId) {
          const row = await tx.concept.create({ data: { courseId: course.id, key: l.conceptKey, name: l.title, description: l.title } });
          conceptId = row.id;
          conceptIds.set(l.conceptKey, conceptId);
        }
        await tx.lesson.create({
          data: { moduleId: mod.id, conceptId, title: l.title, content: l.content, order: li, difficulty: l.difficulty, minutes: l.minutes },
        });
      }
    }
    return course.id;
  });
  const lessons = await db.lesson.findMany({ where: { module: { courseId } }, select: { id: true, title: true, content: true } });
  for (const l of lessons) await indexText(db, { courseId, lessonId: l.id, text: `# ${l.title}\n\n${l.content}` });
  return courseId;
}

export async function generateCourse(db: Db, user: AuthUser, input: GenerateCourseInput) {
  await assertQuota(db, user, "course");
  let sourceText: string | undefined;
  if (input.documentId) {
    const doc = await db.document.findUnique({ where: { id: input.documentId } });
    if (!doc || doc.ownerId !== user.id) throw notFound("Document");
    sourceText = doc.text;
  }
  const outline = await ai().run("course", { topic: input.topic, level: input.level, sourceText, moduleCount: input.moduleCount });
  const courseId = await persistCourse(db, user.id, outline, { topic: input.topic, source: sourceText ? "UPLOAD" : "TOPIC" });
  if (input.documentId && sourceText) {
    await db.document.update({ where: { id: input.documentId }, data: { courseId } });
    await indexText(db, { courseId, documentId: input.documentId, text: sourceText });
  }
  await recordUsage(db, user.id, "course");
  await generateFlashcardsForCourse(db, courseId);
  await db.enrollment.create({ data: { userId: user.id, courseId } });
  const award = await awardXp(db, user.id, XP.courseCreated, "course-created");
  return { courseId, award };
}

export async function listCatalog(db: Db, opts: { search?: string; take?: number; cursor?: string }) {
  const where: Prisma.CourseWhereInput = {
    status: "PUBLISHED",
    ...(opts.search
      ? { OR: [{ title: { contains: opts.search, mode: "insensitive" } }, { topic: { contains: opts.search, mode: "insensitive" } }] }
      : {}),
  };
  const take = opts.take ?? 24;
  const items = await db.course.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { author: { select: { name: true } }, _count: { select: { enrollments: true, modules: true } } },
  });
  const nextCursor = items.length > take ? items.pop()!.id : null;
  return { items, nextCursor };
}

export async function myCourses(db: Db, user: AuthUser) {
  const [enrolled, authored] = await Promise.all([
    db.enrollment.findMany({
      where: { userId: user.id },
      include: { course: { include: { modules: { include: { lessons: { select: { id: true } } } } } } },
      orderBy: { createdAt: "desc" },
    }),
    db.course.findMany({ where: { authorId: user.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { enrollments: true } } } }),
  ]);
  const done = await db.lessonProgress.findMany({ where: { userId: user.id }, select: { lessonId: true } });
  const doneSet = new Set(done.map((d) => d.lessonId));
  return {
    enrolled: enrolled.map((e) => {
      const ids = e.course.modules.flatMap((m) => m.lessons.map((l) => l.id));
      const completed = ids.filter((id) => doneSet.has(id)).length;
      const { modules: _m, ...course } = e.course;
      return { ...course, totalLessons: ids.length, completedLessons: completed, progress: ids.length ? completed / ids.length : 0 };
    }),
    authored,
  };
}

async function loadCourseForUser(db: Db, user: AuthUser, courseId: string) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: {
      author: { select: { id: true, name: true } },
      concepts: { orderBy: { name: "asc" } },
      modules: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" }, select: { id: true, title: true, order: true, difficulty: true, minutes: true, conceptId: true } } } },
      exercises: { select: { id: true, title: true, lessonId: true, language: true } },
    },
  });
  if (!course) throw notFound("Course");
  if (course.status !== "PUBLISHED" && !canEdit(user, course.authorId)) {
    const enrolled = await db.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId } } });
    if (!enrolled) throw forbidden();
  }
  return course;
}

export async function getCourse(db: Db, user: AuthUser, courseId: string) {
  const course = await loadCourseForUser(db, user, courseId);
  const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  const [progress, enrollment, mastery] = await Promise.all([
    db.lessonProgress.findMany({ where: { userId: user.id, lessonId: { in: lessonIds } }, select: { lessonId: true } }),
    db.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId } } }),
    masteryMap(db, user.id, course.concepts.map((c) => c.id)),
  ]);
  const completed = new Set(progress.map((p) => p.lessonId));
  const lessons = course.modules.flatMap((m) => m.lessons);
  const recommendation = recommendNext(lessons, completed, mastery);
  return {
    ...course,
    canEdit: canEdit(user, course.authorId),
    enrolled: !!enrollment,
    completedLessonIds: [...completed],
    mastery: Object.fromEntries([...mastery.entries()].map(([k, v]) => [k, v.pKnown])),
    recommendation,
  };
}

export async function getLesson(db: Db, user: AuthUser, lessonId: string) {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    include: { module: { select: { courseId: true, title: true, order: true } }, concept: true, exercises: { select: { id: true, title: true } } },
  });
  if (!lesson) throw notFound("Lesson");
  const course = await loadCourseForUser(db, user, lesson.module.courseId);
  const flat = course.modules.flatMap((m) => m.lessons);
  const idx = flat.findIndex((l) => l.id === lessonId);
  const [done, mastery] = await Promise.all([
    db.lessonProgress.findUnique({ where: { userId_lessonId: { userId: user.id, lessonId } } }),
    lesson.conceptId ? db.conceptMastery.findUnique({ where: { userId_conceptId: { userId: user.id, conceptId: lesson.conceptId } } }) : null,
  ]);
  return {
    ...lesson,
    course: { id: course.id, title: course.title, canEdit: canEdit(user, course.authorId) },
    prevLessonId: flat[idx - 1]?.id ?? null,
    nextLessonId: flat[idx + 1]?.id ?? null,
    completed: !!done,
    mastery: mastery?.pKnown ?? null,
  };
}

export async function enroll(db: Db, user: AuthUser, courseId: string) {
  await loadCourseForUser(db, user, courseId);
  await db.enrollment.upsert({ where: { userId_courseId: { userId: user.id, courseId } }, create: { userId: user.id, courseId }, update: {} });
  return { enrolled: true };
}

export async function completeLesson(db: Db, user: AuthUser, lessonId: string) {
  const lesson = await getLesson(db, user, lessonId);
  const existing = await db.lessonProgress.findUnique({ where: { userId_lessonId: { userId: user.id, lessonId } } });
  if (existing) return { alreadyCompleted: true, award: null, nextLessonId: lesson.nextLessonId };
  await db.lessonProgress.create({ data: { userId: user.id, lessonId } });
  await db.enrollment.upsert({
    where: { userId_courseId: { userId: user.id, courseId: lesson.course.id } },
    create: { userId: user.id, courseId: lesson.course.id },
    update: {},
  });
  const award = await awardXp(db, user.id, XP.lessonComplete, "lesson-complete");
  return { alreadyCompleted: false, award, nextLessonId: lesson.nextLessonId };
}

async function assertEditable(db: Db, user: AuthUser, courseId: string) {
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound("Course");
  if (!canEdit(user, course.authorId)) throw forbidden("Only the course author can edit this course");
  return course;
}

export async function updateCourse(db: Db, user: AuthUser, courseId: string, data: { title?: string; description?: string; level?: number }) {
  await assertEditable(db, user, courseId);
  return db.course.update({ where: { id: courseId }, data });
}

export async function updateLesson(db: Db, user: AuthUser, lessonId: string, data: { title?: string; content?: string; difficulty?: number }) {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { module: true } });
  if (!lesson) throw notFound("Lesson");
  await assertEditable(db, user, lesson.module.courseId);
  const updated = await db.lesson.update({ where: { id: lessonId }, data });
  if (data.content || data.title) await reindexLesson(db, lesson.module.courseId, lessonId, `# ${updated.title}\n\n${updated.content}`);
  return updated;
}

export async function addLesson(db: Db, user: AuthUser, moduleId: string, title: string) {
  const mod = await db.module.findUnique({ where: { id: moduleId }, include: { lessons: true } });
  if (!mod) throw notFound("Module");
  await assertEditable(db, user, mod.courseId);
  const content = `## ${title}\n\nWrite your lesson here. Use **Markdown**, $KaTeX$ math and fenced code blocks.`;
  return db.lesson.create({ data: { moduleId, title, content, order: mod.lessons.length } });
}

export async function setPublished(db: Db, user: AuthUser, courseId: string, published: boolean) {
  const course = await assertEditable(db, user, courseId);
  if (published && !hasRole(user, "INSTRUCTOR")) throw forbidden("Instructor role is required to publish courses to the catalog");
  if (published) {
    const lessons = await db.lesson.count({ where: { module: { courseId } } });
    if (lessons === 0) throw new AppError("BAD_REQUEST", "A course needs at least one lesson before publishing");
  }
  return db.course.update({
    where: { id: course.id },
    data: { status: published ? "PUBLISHED" : "DRAFT", publishedAt: published ? (course.publishedAt ?? new Date()) : course.publishedAt },
  });
}

export async function deleteCourse(db: Db, user: AuthUser, courseId: string) {
  await assertEditable(db, user, courseId);
  await db.course.delete({ where: { id: courseId } });
  return { deleted: true };
}
