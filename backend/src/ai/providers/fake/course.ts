import { createRng, shuffle } from "../../../lib/rng";
import { keywords, slugify, splitSentences, titleCase } from "../../../lib/text";
import type { CourseOutline } from "../../schemas";
import type { CourseInput } from "../../types";
import { FACETS, isMathTopic, isProgrammingTopic } from "./knowledge";

const MODULE_NAMES = ["Getting Started", "Building Understanding", "Applying the Ideas", "Going Further", "Mastery"];

function topicLessonContent(topic: string, facet: (typeof FACETS)[number], difficulty: number): string {
  const t = titleCase(topic);
  const parts: string[] = [
    `## ${facet.name} of ${t}`,
    `This lesson covers ${facet.blurb} in ${t}. ${t} rewards a structured approach: identify the inputs, apply a well-defined rule, and check the result against what you expected.`,
    `### Key ideas`,
    `- **Definition first.** Every topic in ${t} starts with precise definitions; ambiguous terms are the main source of errors.`,
    `- **Decomposition.** Break a ${t} problem into smaller sub-problems, solve each one, then combine the results.`,
    `- **Verification.** After each step, verify the intermediate result; ${facet.name.toLowerCase()} is where small mistakes compound.`,
    `### Worked example`,
    `Suppose you face a typical ${t} task at difficulty ${difficulty}. First restate the problem in your own words, then list what is known and what is unknown. Apply the technique from this lesson one step at a time and write down why each step is valid.`,
  ];
  if (isMathTopic(topic)) {
    parts.push(
      `For instance, solving a linear relationship means isolating the unknown:`,
      `$$ a x + b = c \\quad\\Longrightarrow\\quad x = \\frac{c - b}{a}, \\; a \\neq 0 $$`,
      `With $a = 2$, $b = 3$ and $c = 11$ we get $x = 4$. Always substitute back: $2 \\cdot 4 + 3 = 11$.`,
    );
  }
  if (isProgrammingTopic(topic)) {
    parts.push(
      "A small, testable function makes the idea concrete:",
      "```javascript\nfunction applyStep(input) {\n  // 1. validate input\n  if (input == null) throw new Error('input required');\n  // 2. transform\n  const result = input * 2;\n  // 3. return a value you can test\n  return result;\n}\n```",
    );
  }
  parts.push(
    "### How the pieces connect",
    "```mermaid\nflowchart LR\n  A[Understand the problem] --> B[Choose a technique]\n  B --> C[Apply step by step]\n  C --> D{Result checks out?}\n  D -- yes --> E[Generalise]\n  D -- no --> B\n```",
    `### Check your understanding`,
    `Explain in one sentence why verification matters for ${facet.name.toLowerCase()} in ${t}, then try the quiz for this lesson.`,
  );
  return parts.join("\n\n");
}

function groundedLessonContent(title: string, sentences: string[], term: string): string {
  const [lead, ...rest] = sentences;
  const bullets = rest.slice(0, 5).map((s) => `- ${s}`);
  return [
    `## ${title}`,
    lead ?? `This lesson focuses on ${term}.`,
    bullets.length ? `### Key ideas from your material\n\n${bullets.join("\n")}` : "",
    `### Worked example`,
    `Where does **${term}** appear in the passage above? What problem does ${term} solve, and what would change if it were missing? Write a two-sentence summary before moving on - can you do it without looking?`,
    "```mermaid\nflowchart LR\n  S[Source material] --> K[" + titleCase(term) + "]\n  K --> Q[Quiz and flashcards]\n```",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Deterministic offline course generator: topic-template driven, or extractive when material is uploaded. */
export function fakeCourse(input: CourseInput): CourseOutline {
  const rng = createRng(`course:${input.topic}:${input.level}:${input.sourceText?.length ?? 0}`);
  const moduleCount = Math.min(Math.max(input.moduleCount ?? 3, 1), 5);
  const level = Math.min(Math.max(Math.round(input.level), 1), 5);

  if (input.sourceText && input.sourceText.trim().length > 200) {
    const sentences = splitSentences(input.sourceText);
    const terms = keywords(input.sourceText, Math.max(moduleCount * 2, 4));
    const concepts = terms.map((t) => ({
      key: slugify(t),
      name: titleCase(t),
      description: sentences.find((s) => s.toLowerCase().includes(t)) ?? `Key idea from the material: ${t}.`,
    }));
    const modules = Array.from({ length: moduleCount }, (_, m) => {
      const moduleTerms = terms.slice(m * 2, m * 2 + 2);
      return {
        title: `${MODULE_NAMES[m] ?? `Part ${m + 1}`}: ${moduleTerms.map(titleCase).join(" & ") || titleCase(input.topic)}`,
        summary: `Builds understanding of ${moduleTerms.join(" and ") || input.topic} directly from your uploaded material.`,
        lessons: moduleTerms.map((term, i) => {
          const related = sentences.filter((s) => s.toLowerCase().includes(term)).slice(0, 6);
          const title = `Understanding ${titleCase(term)}`;
          return {
            title,
            conceptKey: slugify(term),
            difficulty: Math.min(5, level + Math.floor((m + i) / 2)),
            minutes: 8 + related.length * 2,
            content: groundedLessonContent(title, related.length ? related : sentences.slice(i, i + 4), term),
          };
        }),
      };
    }).filter((m) => m.lessons.length > 0);
    return {
      title: titleCase(input.topic),
      description: `A course generated from your study material covering ${terms.slice(0, 4).join(", ")}.`,
      level,
      concepts,
      modules,
    };
  }

  const lessonsPerModule = 2;
  const facets = FACETS.slice(0, moduleCount * lessonsPerModule);
  const concepts = facets.map((f) => ({
    key: f.key,
    name: `${f.name} of ${titleCase(input.topic)}`,
    description: `Understand ${f.blurb} in ${input.topic}.`,
  }));
  const order = shuffle([0, 1], rng); // vary lesson emphasis deterministically per topic
  return {
    title: `${titleCase(input.topic)}: From Fundamentals to Practice`,
    description: `An adaptive ${["", "introductory", "beginner-friendly", "intermediate", "advanced", "expert-level"][level]} course on ${input.topic}. You will learn ${facets
      .slice(0, 3)
      .map((f) => f.blurb)
      .join(", ")} and more, with quizzes and spaced-repetition flashcards for every concept.`,
    level,
    concepts,
    modules: Array.from({ length: moduleCount }, (_, m) => ({
      title: `Module ${m + 1}: ${MODULE_NAMES[m] ?? "Advanced Topics"}`,
      summary: `Covers ${facets
        .slice(m * lessonsPerModule, m * lessonsPerModule + lessonsPerModule)
        .map((f) => f.name.toLowerCase())
        .join(" and ")} of ${input.topic}.`,
      lessons: order.map((o) => {
        const facet = facets[m * lessonsPerModule + o]!;
        const difficulty = Math.min(5, Math.max(1, level - 1 + m));
        return {
          title: `${facet.name} of ${titleCase(input.topic)}`,
          conceptKey: facet.key,
          difficulty,
          minutes: 10 + difficulty * 3,
          content: topicLessonContent(input.topic, facet, difficulty),
        };
      }),
    })),
  };
}
