import { createRng, pick, shuffle } from "../../../lib/rng";
import { contentTokens, keywords, splitSentences, titleCase, truncate } from "../../../lib/text";
import type { FlashcardSet, QuestionDraft, QuizDraft } from "../../schemas";
import type { FlashcardInput, QuizInput } from "../../types";
import { isProgrammingTopic, pickCode } from "./knowledge";

const GENERIC_DISTRACTORS = ["iteration", "abstraction", "notation", "approximation", "convention", "heuristic"];

function blankOut(sentence: string, term: string): string | null {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(sentence) ? sentence.replace(re, "_____") : null;
}

function distractors(answer: string, pool: string[], rng: () => number, n = 3): string[] {
  const candidates = shuffle(
    [...new Set([...pool, ...GENERIC_DISTRACTORS])].filter((t) => t.toLowerCase() !== answer.toLowerCase()),
    rng,
  );
  return candidates.slice(0, n);
}

/**
 * Deterministic quiz generator. `errorRate` simulates LLM hallucinations (a wrong answer key)
 * so the LLM-as-judge quality gate has something to catch in offline mode.
 */
export function fakeQuiz(input: QuizInput, errorRate = 0): QuizDraft {
  const rng = createRng(`quiz:${input.lessonTitle}:${input.difficulty}:${input.count}`);
  const sentences = splitSentences(input.lessonContent);
  const terms = keywords(input.lessonContent, 12);
  const conceptKey = input.concepts[0]?.key ?? "general";
  const questions: QuestionDraft[] = [];

  // Harder quizzes shift the mix towards open-ended and code questions.
  const mix: QuestionDraft["type"][] =
    input.difficulty >= 4
      ? ["MCQ", "SHORT_ANSWER", "TRUE_FALSE", "MCQ", "SHORT_ANSWER"]
      : input.difficulty <= 2
        ? ["MCQ", "TRUE_FALSE", "MCQ", "TRUE_FALSE", "SHORT_ANSWER"]
        : ["MCQ", "TRUE_FALSE", "SHORT_ANSWER", "MCQ", "TRUE_FALSE"];

  const usable = shuffle(
    sentences.flatMap((s) => terms.filter((t) => blankOut(s, t)).slice(0, 1).map((t) => ({ s, t }))),
    rng,
  );

  let cursor = 0;
  const wantCode = input.includeCode && isProgrammingTopic(`${input.courseTitle} ${input.lessonTitle} ${input.lessonContent}`);
  const target = Math.max(1, input.count - (wantCode ? 1 : 0));

  for (let i = 0; questions.length < target && i < target * 3; i++) {
    const type = mix[i % mix.length]!;
    const item = usable[cursor % Math.max(usable.length, 1)];
    cursor++;
    const concept = input.concepts[i % Math.max(input.concepts.length, 1)]?.key ?? conceptKey;

    if (type === "MCQ" && item) {
      const prompt = `Fill in the blank: "${blankOut(item.s, item.t)}"`;
      const opts = shuffle([item.t, ...distractors(item.t, terms, rng)], rng);
      const hallucinate = rng() < errorRate;
      const answer = hallucinate ? (opts.find((o) => o !== item.t) ?? item.t) : item.t;
      questions.push({
        type,
        prompt,
        options: opts,
        answer,
        explanation: `The lesson states: "${truncate(item.s, 240)}"`,
        conceptKey: concept,
        difficulty: input.difficulty,
        keyPoints: [],
        code: null,
      });
    } else if (type === "TRUE_FALSE" && item) {
      const truthful = rng() < 0.5;
      const swap = pick(
        terms.filter((t) => t !== item.t),
        rng,
      );
      const statement = truthful ? item.s : item.s.replace(new RegExp(`\\b${item.t}\\b`, "i"), swap);
      questions.push({
        type,
        prompt: `True or false: ${statement}`,
        options: ["true", "false"],
        answer: truthful ? "true" : "false",
        explanation: truthful
          ? `True - this is stated directly in the lesson.`
          : `False - the lesson says "${truncate(item.s, 200)}" (it refers to ${item.t}, not ${swap}).`,
        conceptKey: concept,
        difficulty: input.difficulty,
        keyPoints: [],
        code: null,
      });
    } else if (type === "SHORT_ANSWER") {
      const focus = item?.t ?? terms[0] ?? input.lessonTitle;
      const support = sentences.filter((s) => s.toLowerCase().includes(focus.toLowerCase())).slice(0, 2);
      const keyPoints = [...new Set(support.flatMap((s) => contentTokens(s)).filter((t) => t !== focus))].slice(0, 3);
      questions.push({
        type,
        prompt: `In 2-3 sentences, explain the role of "${focus}" in ${input.lessonTitle} and why it matters.`,
        options: [],
        answer: support.join(" ") || `${titleCase(focus)} is central to ${input.lessonTitle}.`,
        explanation: `A strong answer mentions ${[focus, ...keyPoints].join(", ")}.`,
        conceptKey: concept,
        difficulty: input.difficulty,
        keyPoints: [focus, ...keyPoints],
        code: null,
      });
    }
  }

  if (wantCode) {
    const spec = pickCode(`${input.lessonTitle}:${input.difficulty}`);
    questions.push({
      type: "CODE",
      prompt: spec.prompt,
      options: [],
      answer: spec.solution,
      explanation: `Run your function against the test cases; all ${spec.tests.length} must pass.`,
      conceptKey: input.concepts.at(-1)?.key ?? conceptKey,
      difficulty: input.difficulty,
      keyPoints: [],
      code: { entrypoint: spec.entrypoint, starterCode: spec.starterCode, solution: spec.solution, tests: spec.tests },
    });
  }

  if (questions.length === 0) {
    questions.push({
      type: "TRUE_FALSE",
      prompt: `True or false: ${input.lessonTitle} is covered in this course.`,
      options: ["true", "false"],
      answer: "true",
      explanation: "This lesson is part of the course syllabus.",
      conceptKey,
      difficulty: input.difficulty,
      keyPoints: [],
      code: null,
    });
  }

  return { title: `${input.lessonTitle} - Quiz`, questions };
}

export function fakeFlashcards(input: FlashcardInput): FlashcardSet {
  const sentences = splitSentences(input.content);
  const cards: FlashcardSet["cards"] = [];
  for (const c of input.concepts) {
    cards.push({ front: `What is "${c.name}"?`, back: c.description, conceptKey: c.key });
  }
  const terms = keywords(input.content, input.count * 2);
  for (const t of terms) {
    if (cards.length >= input.count) break;
    const s = sentences.find((x) => blankOut(x, t));
    if (!s) continue;
    cards.push({
      front: `Complete: ${blankOut(s, t)}`,
      back: titleCase(t),
      conceptKey: input.concepts.find((c) => c.name.toLowerCase().includes(t))?.key ?? input.concepts[0]?.key ?? "general",
    });
  }
  return { cards: cards.slice(0, Math.max(1, input.count)) };
}
