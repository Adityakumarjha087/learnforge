import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuizPlayer, type QuizResult, type QuizView } from "../quiz-player";

vi.mock("../mermaid", () => ({ Mermaid: () => <div>diagram</div> }));

const quiz = {
  id: "q1",
  title: "Arrays quiz",
  difficulty: 2,
  status: "PUBLISHED",
  course: { id: "c1", title: "JS" },
  lesson: { id: "l1", title: "Arrays" },
  judgeReport: null,
  questions: [
    { id: "a", type: "MCQ", prompt: "Pick **map**", options: ["map", "filter"], order: 0, code: null },
    { id: "b", type: "TRUE_FALSE", prompt: "Arrays are zero-indexed", options: ["true", "false"], order: 1, code: null },
    { id: "c", type: "SHORT_ANSWER", prompt: "Explain reduce", options: [], order: 2, code: null },
    { id: "d", type: "CODE", prompt: "Write sum", options: [], order: 3, code: { starterCode: "function sum(){}", entrypoint: "sum", tests: [{ args: "[]", expected: "0" }] } },
  ],
} as unknown as QuizView;

describe("QuizPlayer", () => {
  it("collects answers for every question type and submits them", async () => {
    const onSubmit = vi.fn();
    render(<QuizPlayer quiz={quiz} onSubmit={onSubmit} />);
    expect(screen.getByText("1/4 answered")).toBeInTheDocument(); // code starter counts
    await userEvent.click(screen.getByLabelText("map"));
    await userEvent.click(screen.getByLabelText("true"));
    await userEvent.type(screen.getByLabelText("Answer for question 3"), "Combines values");
    expect(screen.getByText("4/4 answered")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: "a", answer: "map" },
      { questionId: "b", answer: "true" },
      { questionId: "c", answer: "Combines values" },
      { questionId: "d", answer: "function sum(){}" },
    ]);
  });

  it("renders graded results with mastery change", () => {
    const result = {
      attemptId: "x",
      score: 0.5,
      correct: 2,
      total: 4,
      nextDifficulty: 3,
      award: { xp: 20, total: 20, newBadges: [], streak: 1 },
      mastery: [{ conceptId: "k", name: "Arrays", before: 0.2, after: 0.6 }],
      results: [
        { questionId: "a", correct: true, score: 1, feedback: "Correct!", explanation: "Because", correctAnswer: "map" },
        { questionId: "b", correct: false, score: 0, feedback: "Not quite", explanation: "Zero", correctAnswer: "true" },
      ],
    } as unknown as QuizResult;
    render(<QuizPlayer quiz={quiz} onSubmit={vi.fn()} result={result} />);
    expect(screen.getByTestId("quiz-score")).toHaveTextContent("50%");
    expect(screen.getByText("20% → 60%")).toBeInTheDocument();
    expect(screen.getByLabelText("Correct")).toBeInTheDocument();
    expect(screen.getByText("Not quite")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("disables submit until something is answered", () => {
    const noCode = { ...quiz, questions: quiz.questions.slice(0, 1) } as QuizView;
    render(<QuizPlayer quiz={noCode} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("filter"));
    expect(screen.getByRole("button", { name: /submit/i })).toBeEnabled();
  });
});
