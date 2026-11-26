import { createRng } from "../lib/rng";

export interface BattleQuestion {
  id: string;
  type: "MCQ" | "TRUE_FALSE";
  prompt: string;
  options: string[];
  answer: string;
}

export interface BattlePlayer {
  userId: string;
  name: string;
  isBot: boolean;
}

export interface AnswerRecord {
  index: number;
  answer: string;
  correct: boolean;
  points: number;
  elapsedMs: number;
}

export const MAX_POINTS = 150;

/** 100 points for a correct answer plus up to 50 speed bonus; wrong answers score 0. */
export function scoreAnswer(correct: boolean, elapsedMs: number, limitMs: number): number {
  if (!correct) return 0;
  const speed = Math.max(0, 1 - elapsedMs / limitMs);
  return 100 + Math.round(50 * speed);
}

const norm = (s: string) => s.trim().toLowerCase();

/** Authoritative, transport-agnostic battle state (the Socket.IO layer only relays events). */
export class Battle {
  readonly answers = new Map<string, AnswerRecord[]>();
  private finishedAt: number | null = null;

  constructor(
    readonly id: string,
    readonly players: [BattlePlayer, BattlePlayer],
    readonly questions: BattleQuestion[],
    readonly perQuestionMs = 15_000,
    readonly startedAt = Date.now(),
  ) {
    for (const p of players) this.answers.set(p.userId, []);
  }

  get finished(): boolean {
    return this.finishedAt !== null;
  }

  publicQuestions() {
    return this.questions.map(({ answer: _a, ...q }) => q);
  }

  submit(userId: string, index: number, answer: string, now = Date.now()): AnswerRecord {
    const list = this.answers.get(userId);
    if (!list) throw new Error("Not a participant");
    if (this.finished) throw new Error("Battle is over");
    if (index !== list.length) throw new Error("Answer questions in order");
    const q = this.questions[index];
    if (!q) throw new Error("No such question");
    // Elapsed time for question i is measured from when the player finished question i-1.
    const prevAt = list.length ? this.startedAt + list.reduce((s, a) => s + a.elapsedMs, 0) : this.startedAt;
    const elapsedMs = Math.min(this.perQuestionMs, Math.max(0, now - prevAt));
    const correct = norm(answer) === norm(q.answer);
    const rec = { index, answer, correct, points: scoreAnswer(correct, elapsedMs, this.perQuestionMs), elapsedMs };
    list.push(rec);
    return rec;
  }

  score(userId: string): number {
    return (this.answers.get(userId) ?? []).reduce((s, a) => s + a.points, 0);
  }

  scores(): Record<string, number> {
    return Object.fromEntries(this.players.map((p) => [p.userId, this.score(p.userId)]));
  }

  allAnswered(): boolean {
    return this.players.every((p) => (this.answers.get(p.userId)?.length ?? 0) >= this.questions.length);
  }

  finish(now = Date.now()): { winnerId: string | null; scores: Record<string, number> } {
    this.finishedAt ??= now;
    const [a, b] = this.players;
    const sa = this.score(a.userId);
    const sb = this.score(b.userId);
    return { winnerId: sa === sb ? null : sa > sb ? a.userId : b.userId, scores: this.scores() };
  }
}

/** Deterministic practice bot: answers with fixed accuracy after a human-like delay. */
export function botPlan(battleId: string, questions: BattleQuestion[], accuracy = 0.6) {
  const rng = createRng(`bot:${battleId}`);
  return questions.map((q) => {
    const correct = rng() < accuracy;
    const wrong = q.options.find((o) => norm(o) !== norm(q.answer)) ?? "";
    return { answer: correct ? q.answer : wrong, delayMs: 1500 + Math.round(rng() * 3500) };
  });
}
