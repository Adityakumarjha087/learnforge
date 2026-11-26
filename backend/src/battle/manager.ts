import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { verifySocketToken, type AuthUser } from "../auth/tokens";
import { XP } from "../gamification/rules";
import { awardXp } from "../gamification/service";
import { logger } from "../lib/logger";
import type { Db } from "../lib/prisma";
import { shuffle } from "../lib/rng";
import { Battle, botPlan, type BattlePlayer, type BattleQuestion } from "./engine";

export const BOT_ID = "learnforge-bot";
const QUESTIONS_PER_BATTLE = 5;

const JoinSchema = z.object({ courseId: z.string().optional(), vsBot: z.boolean().optional() });
const AnswerSchema = z.object({ battleId: z.string(), index: z.number().int().min(0), answer: z.string().max(500) });

interface Waiting {
  socket: Socket;
  user: AuthUser;
  courseId?: string;
  timer: NodeJS.Timeout;
}

export interface BattleManagerOptions {
  perQuestionMs?: number;
  queueTimeoutMs?: number;
  botAccuracy?: number;
  botDelayScale?: number;
  random?: () => number;
}

/** Real-time 1v1 quiz battles over Socket.IO: matchmaking queue, authoritative scoring, practice bot. */
export class BattleManager {
  readonly io: Server;
  private readonly queue: Waiting[] = [];
  private readonly battles = new Map<string, Battle>();
  private readonly timers = new Map<string, NodeJS.Timeout[]>();

  constructor(
    httpServer: HttpServer,
    private readonly db: Db,
    corsOrigins: string[],
    private readonly opts: BattleManagerOptions = {},
  ) {
    this.io = new Server(httpServer, { cors: { origin: corsOrigins, credentials: true }, path: "/socket.io" });
    this.io.use(async (socket, next) => {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      const user = token ? await verifySocketToken(token) : null;
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = user;
      next();
    });
    this.io.on("connection", (socket) => this.onConnection(socket));
  }

  private onConnection(socket: Socket) {
    const user = socket.data.user as AuthUser;
    socket.on("queue:join", (payload: unknown) => {
      const parsed = JoinSchema.safeParse(payload ?? {});
      if (!parsed.success) return socket.emit("battle:error", { message: "Invalid request" });
      void this.join(socket, user, parsed.data).catch((err) => this.fail(socket, err));
    });
    socket.on("queue:leave", () => this.leaveQueue(socket.id));
    socket.on("battle:answer", (payload: unknown) => {
      const parsed = AnswerSchema.safeParse(payload);
      if (!parsed.success) return socket.emit("battle:error", { message: "Invalid answer" });
      void this.answer(socket, user, parsed.data).catch((err) => this.fail(socket, err));
    });
    socket.on("disconnect", () => {
      this.leaveQueue(socket.id);
      for (const b of this.battles.values()) {
        if (!b.finished && b.players.some((p) => p.userId === user.id)) {
          const other = b.players.find((p) => p.userId !== user.id);
          void this.finish(b, other && !other.isBot ? other.userId : undefined, "ABANDONED");
        }
      }
    });
  }

  private fail(socket: Socket, err: unknown) {
    logger.warn({ err: (err as Error).message }, "battle error");
    socket.emit("battle:error", { message: (err as Error).message });
  }

  private leaveQueue(socketId: string) {
    const i = this.queue.findIndex((w) => w.socket.id === socketId);
    if (i >= 0) {
      clearTimeout(this.queue[i]!.timer);
      this.queue.splice(i, 1);
    }
  }

  private async join(socket: Socket, user: AuthUser, req: z.infer<typeof JoinSchema>) {
    this.leaveQueue(socket.id);
    if (req.vsBot) return this.start(req.courseId, [{ socket, user }], true);
    const match = this.queue.find((w) => w.user.id !== user.id && (w.courseId ?? null) === (req.courseId ?? null));
    if (match) {
      this.leaveQueue(match.socket.id);
      return this.start(req.courseId, [{ socket: match.socket, user: match.user }, { socket, user }], false);
    }
    const timer = setTimeout(() => {
      this.leaveQueue(socket.id);
      socket.emit("queue:timeout", { message: "No opponent found. Try a practice battle against LearnBot!" });
    }, this.opts.queueTimeoutMs ?? 30_000);
    this.queue.push({ socket, user, courseId: req.courseId, timer });
    socket.emit("queue:waiting", { position: this.queue.length });
  }

  async pickQuestions(courseId?: string): Promise<BattleQuestion[]> {
    const rows = await this.db.question.findMany({
      where: { type: { in: ["MCQ", "TRUE_FALSE"] }, quiz: { status: "PUBLISHED", ...(courseId ? { courseId } : { course: { status: "PUBLISHED" } }) } },
      select: { id: true, type: true, prompt: true, options: true, answer: true },
      take: 200,
    });
    return shuffle(rows, this.opts.random ?? Math.random)
      .slice(0, QUESTIONS_PER_BATTLE)
      .map((r) => ({ id: r.id, type: r.type as "MCQ" | "TRUE_FALSE", prompt: r.prompt, options: (r.options as string[] | null) ?? ["true", "false"], answer: r.answer }));
  }

  private async start(courseId: string | undefined, humans: { socket: Socket; user: AuthUser }[], vsBot: boolean) {
    const questions = await this.pickQuestions(courseId);
    if (questions.length === 0) {
      for (const h of humans) h.socket.emit("battle:error", { message: "No published quiz questions available for a battle yet." });
      return;
    }
    const players: BattlePlayer[] = humans.map((h) => ({ userId: h.user.id, name: h.user.name, isBot: false }));
    if (vsBot) players.push({ userId: BOT_ID, name: "LearnBot 🤖", isBot: true });
    const row = await this.db.battle.create({
      data: { courseId: courseId ?? null, playerAId: players[0]!.userId, playerBId: vsBot ? null : players[1]!.userId, vsBot, questions: questions.map((q) => q.id) },
    });
    const perQ = this.opts.perQuestionMs ?? 15_000;
    const battle = new Battle(row.id, [players[0]!, players[1]!], questions, perQ);
    this.battles.set(battle.id, battle);
    const room = `battle:${battle.id}`;
    for (const h of humans) {
      await h.socket.join(room);
      const opponent = players.find((p) => p.userId !== h.user.id)!;
      h.socket.emit("battle:start", { battleId: battle.id, opponent: { id: opponent.userId, name: opponent.name, isBot: opponent.isBot }, questions: battle.publicQuestions(), perQuestionMs: perQ });
    }
    const timers: NodeJS.Timeout[] = [setTimeout(() => void this.finish(battle), perQ * questions.length + 5_000)];
    if (vsBot) {
      let at = 0;
      const scale = this.opts.botDelayScale ?? 1;
      botPlan(battle.id, questions, this.opts.botAccuracy ?? 0.6).forEach((step, index) => {
        at += step.delayMs * scale;
        timers.push(
          setTimeout(() => {
            if (battle.finished) return;
            const rec = battle.submit(BOT_ID, index, step.answer, battle.startedAt + Math.round(at));
            this.io.to(room).emit("battle:progress", { userId: BOT_ID, index, correct: rec.correct, points: rec.points, scores: battle.scores() });
            if (battle.allAnswered()) void this.finish(battle);
          }, at),
        );
      });
    }
    this.timers.set(battle.id, timers);
  }

  private async answer(socket: Socket, user: AuthUser, a: z.infer<typeof AnswerSchema>) {
    const battle = this.battles.get(a.battleId);
    if (!battle) throw new Error("Battle not found");
    const rec = battle.submit(user.id, a.index, a.answer);
    const q = battle.questions[a.index]!;
    socket.emit("battle:feedback", { index: a.index, correct: rec.correct, correctAnswer: q.answer, points: rec.points });
    this.io.to(`battle:${battle.id}`).emit("battle:progress", { userId: user.id, index: a.index, correct: rec.correct, points: rec.points, scores: battle.scores() });
    if (battle.allAnswered()) await this.finish(battle);
  }

  private async finish(battle: Battle, forcedWinner?: string, status: "FINISHED" | "ABANDONED" = "FINISHED") {
    if (battle.finished) return;
    const result = battle.finish();
    const winnerId = forcedWinner ?? result.winnerId;
    for (const t of this.timers.get(battle.id) ?? []) clearTimeout(t);
    this.timers.delete(battle.id);
    const [a, b] = battle.players;
    await this.db.battle.update({
      where: { id: battle.id },
      data: {
        scoreA: result.scores[a.userId] ?? 0,
        scoreB: result.scores[b.userId] ?? 0,
        winnerId: winnerId && winnerId !== BOT_ID ? winnerId : null,
        status,
        endedAt: new Date(),
      },
    });
    const xp: Record<string, number> = {};
    for (const p of battle.players) {
      if (p.isBot) continue;
      const amount = p.userId === winnerId ? XP.battleWin : XP.battleLoss;
      xp[p.userId] = amount;
      await awardXp(this.db, p.userId, amount, p.userId === winnerId ? "battle-win" : "battle-played").catch(() => undefined);
    }
    this.io.to(`battle:${battle.id}`).emit("battle:end", { battleId: battle.id, winnerId, scores: result.scores, xp, status });
    this.battles.delete(battle.id);
  }

  async close() {
    for (const ts of this.timers.values()) ts.forEach(clearTimeout);
    for (const w of this.queue) clearTimeout(w.timer);
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
  }
}

export async function battleHistory(db: Db, userId: string, take = 10) {
  const rows = await db.battle.findMany({
    where: { OR: [{ playerAId: userId }, { playerBId: userId }], status: { not: "ACTIVE" } },
    orderBy: { createdAt: "desc" },
    take,
    include: { playerA: { select: { name: true } }, playerB: { select: { name: true } } },
  });
  return rows.map((r) => {
    const isA = r.playerAId === userId;
    return {
      id: r.id,
      opponent: r.vsBot ? "LearnBot 🤖" : isA ? (r.playerB?.name ?? "Unknown") : r.playerA.name,
      myScore: isA ? r.scoreA : r.scoreB,
      theirScore: isA ? r.scoreB : r.scoreA,
      result: r.winnerId === userId ? "win" : r.winnerId === null && r.scoreA === r.scoreB ? "draw" : "loss",
      createdAt: r.createdAt,
    };
  });
}
