import { contentTokens, overlap, splitSentences } from "../../../lib/text";
import type { Grade, Hint, JudgeReport } from "../../schemas";
import type { CodeHintInput, GradeInput, JudgeInput } from "../../types";

const stem = (t: string) => t.toLowerCase().slice(0, 5);

/** Rubric-coverage grader: counts key points present (by stem) plus semantic overlap with the model answer. */
export function fakeGrade(input: GradeInput): Grade {
  const response = input.response.trim();
  if (response.length < 3) {
    return { score: 0, correct: false, feedback: "No answer was given. Try writing what you remember, even if unsure.", missedPoints: input.keyPoints };
  }
  const tokens = new Set(contentTokens(response).map(stem));
  const missed = input.keyPoints.filter((kp) => !contentTokens(kp).some((t) => tokens.has(stem(t))));
  const coverage = input.keyPoints.length ? (input.keyPoints.length - missed.length) / input.keyPoints.length : 0;
  const sim = Math.min(1, overlap(response, input.modelAnswer) * 3);
  const score = Math.round((0.7 * coverage + 0.3 * sim) * 100) / 100;
  const correct = score >= 0.6;
  const feedback = correct
    ? `Good answer - you covered ${input.keyPoints.length - missed.length} of ${input.keyPoints.length} key points.${missed.length ? ` To make it complete, also mention: ${missed.join(", ")}.` : ""}`
    : `Partially there. Your answer is missing: ${missed.join(", ") || "a clear explanation"}. Revisit the lesson section on these ideas and try again.`;
  return { score, correct, feedback, missedPoints: missed };
}

/**
 * Offline LLM-as-judge. Performs the checks a reviewer model is prompted to do: structural validity,
 * single unambiguous key, and grounding of the keyed answer in the source passage.
 */
export function fakeJudge(input: JudgeInput): JudgeReport {
  const source = input.sourceText.toLowerCase();
  const sentences = splitSentences(input.sourceText).map((s) => s.toLowerCase());
  const verdicts = input.questions.map((q, index) => {
    const issues: string[] = [];
    if (q.prompt.trim().length < 10) issues.push("Prompt is too short to be unambiguous.");
    if (!q.explanation.trim()) issues.push("Missing explanation.");
    switch (q.type) {
      case "MCQ": {
        const opts = q.options.map((o) => o.trim().toLowerCase());
        if (opts.length < 2) issues.push("MCQ needs at least two options.");
        if (new Set(opts).size !== opts.length) issues.push("Duplicate options.");
        if (!opts.includes(q.answer.trim().toLowerCase())) issues.push("Answer key does not match any option.");
        const blank = q.prompt.match(/"(.*)"/)?.[1]?.toLowerCase();
        if (blank?.includes("_____")) {
          const filled = blank.replace("_____", q.answer.toLowerCase());
          const grounded = sentences.some((s) => s.includes(filled));
          if (!grounded) issues.push(`Keyed answer "${q.answer}" is not supported by the source text.`);
        } else if (!source.includes(q.answer.toLowerCase())) {
          issues.push(`Keyed answer "${q.answer}" is not supported by the source text.`);
        }
        break;
      }
      case "TRUE_FALSE":
        if (!["true", "false"].includes(q.answer.trim().toLowerCase())) issues.push("TRUE_FALSE answer must be 'true' or 'false'.");
        break;
      case "SHORT_ANSWER":
        if (q.keyPoints.length === 0) issues.push("Short answer needs a grading rubric (key points).");
        break;
      case "CODE":
        if (!q.code || q.code.tests.length === 0) issues.push("Code question needs test cases.");
        break;
    }
    return { index, valid: issues.length === 0, issues };
  });
  const invalid = verdicts.filter((v) => !v.valid).length;
  return {
    verdicts,
    summary: invalid === 0 ? `All ${verdicts.length} items passed review.` : `${invalid} of ${verdicts.length} items failed review.`,
  };
}

export function fakeCodeHint(input: CodeHintInput): Hint {
  const f = input.failures[0];
  if (!f) return { hint: "All tests pass - nice work! Can you make the solution more readable?" };
  const err = f.error ?? "";
  if (/is not defined|not a function/i.test(err) && err.includes(input.entrypoint)) {
    return { hint: `The tests call a function named \`${input.entrypoint}\`. Is your function declared with exactly that name?` };
  }
  if (/timed out|interrupted|timeout/i.test(err)) {
    return { hint: "Your code did not finish in time. Is there a loop or recursive call whose stopping condition is never reached?" };
  }
  if (err) return { hint: `Your code threw an error: \`${err.slice(0, 160)}\`. Which line could produce that, and what value does it receive for input ${f.args}?` };
  if (f.actual === null || f.actual === "undefined") {
    return { hint: "Your function ran but returned nothing. Does every path through it end with a `return` statement?" };
  }
  const exp = Number(f.expected);
  const act = Number(f.actual);
  if (Number.isFinite(exp) && Number.isFinite(act) && Math.abs(exp - act) <= 1) {
    return { hint: `For input ${f.args} you are off by one (got ${f.actual}, expected ${f.expected}). Check your loop bounds or base case.` };
  }
  return {
    hint: `For input ${f.args} your function returned ${f.actual}, but ${f.expected} was expected. Trace your code by hand with that input - where does the value first diverge?`,
  };
}
