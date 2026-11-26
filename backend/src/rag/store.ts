import { Prisma } from "@prisma/client";
import { getEmbedder } from "../ai/embeddings";
import type { Db } from "../lib/prisma";
import { chunkText } from "./chunker";

const toVector = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(",")}]`;

export interface IndexSource {
  courseId: string;
  documentId?: string;
  lessonId?: string;
  text: string;
}

/** Chunk, embed and store text for a course in pgvector. Returns the number of chunks written. */
export async function indexText(db: Db, src: IndexSource): Promise<number> {
  const chunks = chunkText(src.text);
  if (chunks.length === 0) return 0;
  const vectors = await getEmbedder().embed(chunks);
  for (let i = 0; i < chunks.length; i++) {
    const row = await db.chunk.create({
      data: { courseId: src.courseId, documentId: src.documentId, lessonId: src.lessonId, content: chunks[i]!, ordinal: i },
      select: { id: true },
    });
    await db.$executeRaw`UPDATE "Chunk" SET embedding = ${toVector(vectors[i]!)}::vector WHERE id = ${row.id}`;
  }
  return chunks.length;
}

export async function reindexLesson(db: Db, courseId: string, lessonId: string, text: string): Promise<number> {
  await db.chunk.deleteMany({ where: { courseId, lessonId } });
  return indexText(db, { courseId, lessonId, text });
}

export interface RetrievedChunk {
  id: string;
  content: string;
  lessonId: string | null;
  score: number;
}

/** Cosine-similarity search restricted to one course (optionally boosting the current lesson). */
export async function retrieve(db: Db, courseId: string, query: string, k = 4, lessonId?: string): Promise<RetrievedChunk[]> {
  const [qv] = await getEmbedder().embed([query]);
  const vec = toVector(qv!);
  const rows = await db.$queryRaw<RetrievedChunk[]>(Prisma.sql`
    SELECT id, content, "lessonId",
           (1 - (embedding <=> ${vec}::vector)) + CASE WHEN "lessonId" = ${lessonId ?? ""} THEN 0.05 ELSE 0 END AS score
    FROM "Chunk"
    WHERE "courseId" = ${courseId} AND embedding IS NOT NULL
    ORDER BY score DESC
    LIMIT ${k}`);
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}
