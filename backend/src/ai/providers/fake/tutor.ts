import { contentTokens, keywords, splitSentences, truncate } from "../../../lib/text";
import type { TutorInput } from "../../types";

const ASKS_FOR_ANSWER = /\b(just tell me|give me the answer|what('?s| is) the answer|solve (it|this) for me|full solution|do my homework)\b/i;
const MATHY = /(\$|\d\s*[-+*/^=]\s*\d|\bequation|\bsolve\b|\bderivative|\bintegral|\bx\s*=)/i;
const REQUEST_WORDS = new Set(["tell", "answer", "explain", "give", "help", "please", "just", "mean", "means", "does", "know", "understand", "solve", "show", "work"]);
const focusTerm = (text: string) => contentTokens(text).find((t) => !REQUEST_WORDS.has(t));

const CODEY = /(```|\bfunction\b|\bcode\b|\bbug\b|\berror\b|=>|\breturn\b)/i;

function bestSentence(question: string, context: TutorInput["context"]): string | null {
  const q = new Set(contentTokens(question));
  let best: { s: string; score: number } | null = null;
  for (const chunk of context) {
    for (const s of splitSentences(chunk.content)) {
      const toks = contentTokens(s);
      const hits = toks.filter((t) => q.has(t)).length;
      const score = hits + chunk.score * 0.5;
      if (!best || score > best.score) best = { s, score };
    }
  }
  return best?.s ?? null;
}

/** Composes a Socratic reply grounded in retrieved material. Never reveals the masked key term. */
export function fakeTutorReply(input: TutorInput): string {
  const last = [...input.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const prevTutor = [...input.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const masked = prevTutor.match(/<!--key:([^>]+)-->/)?.[1];

  if (masked && contentTokens(last).includes(masked.toLowerCase())) {
    return `Exactly - **${masked}** is the missing piece. 🎉\n\nNow push one level deeper: how would you explain *why* ${masked} matters to a friend who has never seen ${input.lessonTitle ?? input.courseTitle}? Try to use an example.`;
  }

  const sentence = bestSentence(last, input.context);
  const qTokens = new Set(contentTokens(last));
  const key = sentence ? (keywords(sentence, 6).find((k) => !qTokens.has(k)) ?? keywords(sentence, 1)[0]) : undefined;
  const lines: string[] = [];

  if (ASKS_FOR_ANSWER.test(last)) {
    lines.push("I won't hand you the answer - you'll remember it far better if you get there yourself. Let's work it out together.");
  } else {
    lines.push("Good question! Let's reason through it step by step rather than jumping to the answer.");
  }

  if (sentence && key) {
    const blanked = sentence.replace(new RegExp(`\\b${key}\\b`, "i"), "_____");
    lines.push(
      `**1.** Here is a relevant idea from the course material:\n\n> ${truncate(blanked, 320)}`,
      `**2.** What word or idea do you think fills the blank? Think about how it connects to *${focusTerm(last) ?? "your question"}*.`,
      `**Hint:** it starts with "${key.slice(0, 2)}" and appears in the lesson ${input.lessonTitle ? `"${input.lessonTitle}"` : "material"}.`,
    );
  } else {
    lines.push(
      "I couldn't find that exact point in this course's material, so let's reason from first principles.",
      "**1.** What do you already know that's related to your question?\n\n**2.** Which part of it feels unclear - the definition, the steps, or when to use it?",
    );
  }

  if (MATHY.test(last)) {
    lines.push(
      "If there's an equation involved, try isolating the unknown one operation at a time. For example, from $$a x + b = c$$ what single operation removes the $+b$ term while keeping both sides equal?",
    );
  }
  if (CODEY.test(last)) {
    lines.push(
      "For code, start by tracing a tiny input by hand:\n\n```javascript\n// 1. pick the smallest input that fails\n// 2. write down each variable after every line\n// 3. compare with what you expected - where does it diverge?\n```",
    );
  }
  if (key) lines.push(`<!--key:${key}-->`);
  return lines.join("\n\n");
}

export async function* streamWords(text: string, delayMs = 12, signal?: AbortSignal): AsyncIterable<string> {
  const parts = text.split(/(\s+)/);
  for (let i = 0; i < parts.length; i += 3) {
    if (signal?.aborted) return;
    yield parts.slice(i, i + 3).join("");
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
}
