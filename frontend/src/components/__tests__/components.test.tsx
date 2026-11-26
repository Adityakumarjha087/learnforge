import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NavLinks } from "../app-shell";
import { CodeEditor } from "../code-editor";
import { FlashcardReviewer, type ReviewCardView } from "../flashcard-reviewer";
import { Markdown } from "../markdown";
import { Button } from "../ui/button";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

vi.mock("../mermaid", () => ({ Mermaid: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/dashboard" }));

const card: ReviewCardView = {
  id: "f1",
  front: "What is a **closure**?",
  back: "A function plus its lexical scope",
  course: { id: "c", title: "JavaScript" },
  concept: "Functions",
  state: "NEW",
  intervals: { again: 0, hard: 0, good: 0, easy: 15 },
} as ReviewCardView;

describe("FlashcardReviewer", () => {
  it("reveals the answer and rates with buttons", async () => {
    const onRate = vi.fn();
    render(<FlashcardReviewer card={card} onRate={onRate} />);
    expect(screen.queryByTestId("card-back")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show answer/i }));
    expect(screen.getByTestId("card-back")).toHaveTextContent("lexical scope");
    expect(screen.getByRole("button", { name: /easy/i })).toHaveTextContent("15d");
    await userEvent.click(screen.getByRole("button", { name: /good/i }));
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it("supports keyboard shortcuts and ignores ratings before reveal", () => {
    const onRate = vi.fn();
    render(<FlashcardReviewer card={card} onRate={onRate} />);
    fireEvent.keyDown(window, { key: "4" });
    expect(onRate).not.toHaveBeenCalled();
    act(() => void fireEvent.keyDown(window, { code: "Space", key: " " }));
    fireEvent.keyDown(window, { key: "1" });
    expect(onRate).toHaveBeenCalledWith(1);
  });

  it("does not rate while busy", async () => {
    const onRate = vi.fn();
    render(<FlashcardReviewer card={card} onRate={onRate} busy />);
    await userEvent.click(screen.getByRole("button", { name: /show answer/i }));
    fireEvent.keyDown(window, { key: "3" });
    expect(onRate).not.toHaveBeenCalled();
  });
});

describe("CodeEditor", () => {
  function Harness() {
    const [v, setV] = useState("ab");
    return <CodeEditor value={v} onChange={setV} label="code" />;
  }
  it("inserts two spaces on Tab and shows line numbers", () => {
    render(<Harness />);
    const ta = screen.getByLabelText("code") as HTMLTextAreaElement;
    ta.setSelectionRange(1, 1);
    fireEvent.keyDown(ta, { key: "Tab" });
    expect(ta.value).toBe("a  b");
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });
});

describe("Markdown", () => {
  it("renders math with KaTeX, code blocks and mermaid diagrams but not raw HTML", () => {
    const { container } = render(<Markdown>{"Inline $x^2$\n\n```js\nconst a = 1;\n```\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n<script>alert(1)</script>"}</Markdown>);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector("code[data-lang='js']")).toHaveTextContent("const a = 1;");
    expect(screen.getByTestId("mermaid")).toHaveTextContent("flowchart LR");
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("NavLinks", () => {
  const base = { id: "u", email: "e", name: "n" };
  it("shows the instructor link only to instructors/admins and marks the active page", () => {
    const { rerender } = render(<NavLinks user={{ ...base, role: "LEARNER" }} pathname="/review" />);
    expect(screen.queryByText("Instructor")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("aria-current", "page");
    rerender(<NavLinks user={{ ...base, role: "INSTRUCTOR" }} pathname="/review" />);
    expect(screen.getByText("Instructor")).toBeInTheDocument();
  });
});

describe("UI states", () => {
  it("renders empty, loading and error states", async () => {
    const retry = vi.fn();
    render(
      <>
        <EmptyState title="Nothing here" description="Add something" />
        <LoadingState label="Fetching" />
        <ErrorState message="Boom" onRetry={retry} />
      </>,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Fetching");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });

  it("button shows a busy state", () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save/i })).toHaveAttribute("aria-busy", "true");
  });
});
