"use client";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { RouterOutputs } from "@/lib/trpc";
import { cn, difficultyName, pct } from "@/lib/utils";
import { CodeEditor } from "./code-editor";
import { Markdown } from "./markdown";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Textarea } from "./ui/input";
import { Progress } from "./ui/progress";

export type QuizView = RouterOutputs["quiz"]["get"];
export type QuizResult = RouterOutputs["quiz"]["submit"];

const TYPE_LABEL = { MCQ: "Multiple choice", TRUE_FALSE: "True / False", SHORT_ANSWER: "Short answer", CODE: "Code" } as const;

export function QuizPlayer({ quiz, onSubmit, submitting, result }: { quiz: QuizView; onSubmit: (answers: { questionId: string; answer: string }[]) => void; submitting?: boolean; result?: QuizResult | null }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(quiz.questions.filter((q) => q.code).map((q) => [q.id, q.code!.starterCode])),
  );
  const answered = useMemo(() => quiz.questions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length, [answers, quiz.questions]);
  const byId = new Map(result?.results.map((r) => [r.questionId, r]));
  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone="primary">{difficultyName(quiz.difficulty)}</Badge>
          <span className="text-sm text-muted-foreground">{quiz.questions.length} questions</span>
        </div>
        {!result && <span className="text-sm text-muted-foreground" aria-live="polite">{answered}/{quiz.questions.length} answered</span>}
      </div>
      {!result && <Progress value={(answered / Math.max(1, quiz.questions.length)) * 100} label="Quiz progress" />}

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-primary/40">
            <CardContent className="flex flex-wrap items-center gap-6 p-5">
              <div>
                <p className="text-sm text-muted-foreground">Score</p>
                <p className="text-3xl font-bold" data-testid="quiz-score">{pct(result.score)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Correct</p>
                <p className="text-xl font-semibold">{result.correct}/{result.total}</p>
              </div>
              <div className="min-w-48 flex-1 space-y-2">
                {result.mastery.map((m) => (
                  <div key={m.conceptId}>
                    <div className="flex justify-between text-xs"><span>{m.name}</span><span>{pct(m.before)} → {pct(m.after)}</span></div>
                    <Progress value={m.after * 100} tone={m.after >= m.before ? "success" : "warning"} label={`${m.name} mastery`} />
                  </div>
                ))}
              </div>
              <p className="w-full text-sm text-muted-foreground">Next quiz will adapt to <strong>{difficultyName(result.nextDifficulty)}</strong> difficulty.</p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <ol className="space-y-4">
        {quiz.questions.map((q, i) => {
          const r = byId.get(q.id);
          return (
            <li key={q.id}>
              <Card className={cn(r && (r.correct ? "border-success/50" : "border-danger/50"))}>
                <CardHeader>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Q{i + 1}</span>
                    <Badge tone="muted">{TYPE_LABEL[q.type]}</Badge>
                    {r && (r.correct ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Correct" /> : <XCircle className="h-4 w-4 text-danger" aria-label="Incorrect" />)}
                  </div>
                  <CardTitle className="font-medium"><Markdown>{q.prompt}</Markdown></CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(q.type === "MCQ" || q.type === "TRUE_FALSE") && (
                    <fieldset className="grid gap-2 sm:grid-cols-2" disabled={!!result}>
                      <legend className="sr-only">Options for question {i + 1}</legend>
                      {q.options.map((o) => (
                        <label key={o} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm hover:bg-muted", answers[q.id] === o && "border-primary bg-accent")}>
                          <input type="radio" name={q.id} value={o} checked={answers[q.id] === o} onChange={() => set(q.id, o)} className="accent-[var(--primary)]" />
                          <span className="capitalize">{o}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {q.type === "SHORT_ANSWER" && (
                    <Textarea rows={3} maxLength={4000} aria-label={`Answer for question ${i + 1}`} placeholder="Explain in your own words…" value={answers[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)} disabled={!!result} />
                  )}
                  {q.type === "CODE" && q.code && (
                    <div className="space-y-2">
                      <CodeEditor value={answers[q.id] ?? ""} onChange={(v) => set(q.id, v)} label={`Code for question ${i + 1}`} readOnly={!!result} />
                      <p className="text-xs text-muted-foreground">Function <code>{q.code.entrypoint}</code> · {q.code.tests.length} tests run in a sandbox on submit.</p>
                    </div>
                  )}
                  {r && (
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      <p className="font-medium">{r.feedback}</p>
                      <div className="mt-1 text-muted-foreground"><Markdown>{r.explanation}</Markdown></div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>

      {!result && (
        <Button size="lg" loading={submitting} onClick={() => onSubmit(quiz.questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? "" })))} disabled={answered === 0}>
          Submit answers
        </Button>
      )}
    </div>
  );
}
