import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { env } from "../config/env";
import { hashString } from "../lib/rng";
import { contentTokens } from "../lib/text";

export const EMBEDDING_DIM = 256;

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * Offline feature-hashing embedder (unigrams + bigrams, signed hashing trick, sub-linear TF).
 * Captures lexical similarity well enough for grounding retrieval with zero external calls.
 */
export class HashingEmbedder implements Embedder {
  readonly name = "hash-256";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
  embedOne(text: string): number[] {
    const v = new Array<number>(EMBEDDING_DIM).fill(0);
    const toks = contentTokens(text);
    const feats = [...toks, ...toks.slice(1).map((t, i) => `${toks[i]}_${t}`)];
    const tf = new Map<string, number>();
    for (const f of feats) tf.set(f, (tf.get(f) ?? 0) + 1);
    for (const [f, n] of tf) {
      const h = hashString(f);
      const sign = h & 1 ? 1 : -1;
      const weight = (1 + Math.log(n)) * (f.includes("_") ? 0.5 : 1);
      v[(h >>> 1) % EMBEDDING_DIM]! += sign * weight;
    }
    return l2normalize(v);
  }
}

export class OpenAIEmbedder implements Embedder {
  readonly name = "openai-text-embedding-3-small-256";
  constructor(private readonly apiKey: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: createOpenAI({ apiKey: this.apiKey }).embeddingModel("text-embedding-3-small"),
      values: texts,
      providerOptions: { openai: { dimensions: EMBEDDING_DIM } },
    });
    return embeddings;
  }
}

let embedder: Embedder | undefined;
export function getEmbedder(): Embedder {
  embedder ??= env().EMBEDDING_PROVIDER === "openai" && env().OPENAI_API_KEY ? new OpenAIEmbedder(env().OPENAI_API_KEY) : new HashingEmbedder();
  return embedder;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}
