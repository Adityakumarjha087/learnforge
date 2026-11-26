import { ai } from "../ai";
import type { ChatMessage } from "../ai/types";
import type { AuthUser } from "../auth/tokens";
import { forbidden, notFound } from "../lib/errors";
import type { Db } from "../lib/prisma";
import { truncate } from "../lib/text";
import { retrieve } from "../rag/store";
import { getCourse } from "./course";
import { assertQuota, recordUsage } from "./usage";

const HISTORY_TURNS = 12;

export async function createSession(db: Db, user: AuthUser, courseId: string, lessonId?: string) {
  await getCourse(db, user, courseId); // access check
  const lesson = lessonId ? await db.lesson.findUnique({ where: { id: lessonId }, select: { title: true } }) : null;
  return db.tutorSession.create({
    data: { userId: user.id, courseId, lessonId, title: lesson ? `Tutor: ${lesson.title}` : "Tutor session" },
  });
}

export async function listSessions(db: Db, user: AuthUser, courseId?: string) {
  return db.tutorSession.findMany({
    where: { userId: user.id, ...(courseId ? { courseId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { course: { select: { title: true } }, _count: { select: { messages: true } } },
  });
}

async function ownSession(db: Db, user: AuthUser, sessionId: string) {
  const session = await db.tutorSession.findUnique({ where: { id: sessionId }, include: { course: true } });
  if (!session) throw notFound("Tutor session");
  if (session.userId !== user.id) throw forbidden();
  return session;
}

/** Hidden state markers (e.g. `<!--key:…-->`) are stored server-side but never shown to learners. */
export const stripMarkers = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "").trim();

export async function sessionMessages(db: Db, user: AuthUser, sessionId: string) {
  const session = await ownSession(db, user, sessionId);
  const messages = await db.tutorMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
  return { session, messages: messages.map((m) => ({ id: m.id, role: m.role as ChatMessage["role"], content: stripMarkers(m.content), createdAt: m.createdAt })) };
}

/** Filters `<!-- … -->` markers out of a token stream even when they span chunk boundaries. */
export async function* filterMarkers(source: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = "";
  for await (const chunk of source) {
    buffer += chunk;
    for (;;) {
      const start = buffer.indexOf("<!--");
      if (start === -1) {
        // Hold back a possible partial "<!-" prefix at the end.
        const safe = buffer.length - 3;
        if (safe > 0) {
          yield buffer.slice(0, safe);
          buffer = buffer.slice(safe);
        }
        break;
      }
      if (start > 0) yield buffer.slice(0, start);
      const end = buffer.indexOf("-->", start);
      if (end === -1) {
        buffer = buffer.slice(start);
        break;
      }
      buffer = buffer.slice(end + 3);
    }
  }
  if (buffer && !buffer.includes("<!--")) yield buffer;
}

export interface TutorTurn {
  stream: AsyncIterable<string>;
  sources: { id: string; snippet: string; score: number; lessonId: string | null }[];
}

/**
 * One tutor turn: persist the learner message, retrieve grounding chunks (pgvector), stream the
 * Socratic reply and persist it once complete.
 */
export async function tutorTurn(db: Db, user: AuthUser, sessionId: string, message: string, signal?: AbortSignal): Promise<TutorTurn> {
  const session = await ownSession(db, user, sessionId);
  await assertQuota(db, user, "tutor");
  await db.tutorMessage.create({ data: { sessionId, role: "user", content: message } });
  await recordUsage(db, user.id, "tutor");

  const history = await db.tutorMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" }, take: HISTORY_TURNS });
  const messages: ChatMessage[] = history.reverse().map((m) => ({ role: m.role as ChatMessage["role"], content: m.content }));
  const lesson = session.lessonId ? await db.lesson.findUnique({ where: { id: session.lessonId }, select: { title: true } }) : null;
  const chunks = await retrieve(db, session.courseId, message, 4, session.lessonId ?? undefined);

  const raw = ai().streamTutor(
    { courseTitle: session.course.title, lessonTitle: lesson?.title, context: chunks.map((c) => ({ content: c.content, score: c.score })), messages },
    signal,
  );

  async function* persisting(): AsyncIterable<string> {
    let full = "";
    for await (const delta of raw) {
      full += delta;
      yield delta;
    }
    await db.tutorMessage.create({ data: { sessionId, role: "assistant", content: full } });
  }

  return {
    stream: filterMarkers(persisting()),
    sources: chunks.map((c) => ({ id: c.id, snippet: truncate(c.content.replace(/\s+/g, " "), 160), score: Math.round(c.score * 1000) / 1000, lessonId: c.lessonId })),
  };
}
