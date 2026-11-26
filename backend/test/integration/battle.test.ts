import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signSocketToken, type AuthUser } from "../../src/auth/tokens";
import { Battle, botPlan, scoreAnswer } from "../../src/battle/engine";
import { BattleManager } from "../../src/battle/manager";
import { battleHistory } from "../../src/battle/manager";
import { caller, createUser, prisma, resetDb, seedCourse, useFakeAi } from "../helpers";

const once = <T>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve));

describe("battle engine", () => {
  const questions = [
    { id: "q1", type: "MCQ" as const, prompt: "p", options: ["a", "b"], answer: "a" },
    { id: "q2", type: "TRUE_FALSE" as const, prompt: "p", options: ["true", "false"], answer: "true" },
  ];
  it("scores correctness plus speed and decides a winner", () => {
    expect(scoreAnswer(true, 0, 10_000)).toBe(150);
    expect(scoreAnswer(true, 10_000, 10_000)).toBe(100);
    expect(scoreAnswer(false, 0, 10_000)).toBe(0);
    const b = new Battle("b1", [{ userId: "x", name: "X", isBot: false }, { userId: "y", name: "Y", isBot: false }], questions, 10_000, 0);
    expect(b.publicQuestions()[0]).not.toHaveProperty("answer");
    b.submit("x", 0, "a", 1000);
    expect(() => b.submit("x", 0, "a", 1000)).toThrow(/in order/);
    expect(() => b.submit("z", 0, "a", 1000)).toThrow(/participant/);
    b.submit("x", 1, "true", 2000);
    b.submit("y", 0, "b", 1000);
    b.submit("y", 1, "false", 1000);
    expect(b.allAnswered()).toBe(true);
    expect(b.finish().winnerId).toBe("x");
    expect(() => b.submit("x", 2, "a")).toThrow(/over/);
  });
  it("bot plans are deterministic", () => {
    expect(botPlan("b", questions)).toEqual(botPlan("b", questions));
    expect(botPlan("b", questions, 1).every((s, i) => s.answer === questions[i]!.answer)).toBe(true);
  });
});

describe("Socket.IO quiz battles", () => {
  const app = Fastify();
  let manager: BattleManager;
  let url: string;
  let alice: AuthUser;
  let bob: AuthUser;
  const sockets: Socket[] = [];

  const client = async (u: AuthUser) => {
    const s = connect(url, { auth: { token: await signSocketToken(u) }, transports: ["websocket"], forceNew: true });
    sockets.push(s);
    await once(s, "connect");
    return s;
  };

  beforeAll(async () => {
    await resetDb();
    useFakeAi();
    const { lessons, instructor } = await seedCourse();
    await caller(instructor).quiz.generate({ lessonId: lessons[0]!.id, difficulty: 2, count: 5 });
    await caller(instructor).quiz.generate({ lessonId: lessons[1]!.id, difficulty: 2, count: 5 });
    alice = await createUser();
    bob = await createUser();
    await app.listen({ port: 0, host: "127.0.0.1" });
    manager = new BattleManager(app.server, prisma, ["*"], { perQuestionMs: 5000, botDelayScale: 0.01, queueTimeoutMs: 300 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await manager.close();
    await app.close();
  });

  it("rejects unauthenticated sockets", async () => {
    const s = connect(url, { auth: { token: "bad" }, transports: ["websocket"], forceNew: true });
    const err = await once<Error>(s, "connect_error");
    expect(err.message).toBe("unauthorized");
    s.disconnect();
  });

  it("matches two players, scores answers in real time and records the result", async () => {
    const a = await client(alice);
    const b = await client(bob);
    const waiting = once<{ position: number }>(a, "queue:waiting");
    a.emit("queue:join", {});
    expect((await waiting).position).toBe(1);
    const startA = once<{ battleId: string; questions: { options: string[] }[]; opponent: { name: string } }>(a, "battle:start");
    const startB = once<{ battleId: string }>(b, "battle:start");
    b.emit("queue:join", {});
    const [sa] = await Promise.all([startA, startB]);
    expect(sa.opponent.name).toBe(bob.name);
    expect(sa.questions.length).toBeGreaterThan(0);
    const full = await prisma.battle.findUniqueOrThrow({ where: { id: sa.battleId } });
    const ids = full.questions as string[];
    const keys = await prisma.question.findMany({ where: { id: { in: ids } } });
    const answerFor = (i: number) => keys.find((k) => k.id === ids[i])!.answer;

    const end = once<{ winnerId: string; scores: Record<string, number>; xp: Record<string, number> }>(a, "battle:end");
    for (let i = 0; i < ids.length; i++) {
      const fb = once<{ correct: boolean }>(a, "battle:feedback");
      a.emit("battle:answer", { battleId: sa.battleId, index: i, answer: answerFor(i) });
      expect((await fb).correct).toBe(true);
      const fbB = once(b, "battle:feedback");
      b.emit("battle:answer", { battleId: sa.battleId, index: i, answer: "wrong" });
      await fbB;
    }
    const result = await end;
    expect(result.winnerId).toBe(alice.id);
    expect(result.xp[alice.id]).toBe(50);
    expect(result.scores[bob.id]).toBe(0);
    const history = await battleHistory(prisma, alice.id);
    expect(history[0]).toMatchObject({ result: "win", opponent: bob.name });
    expect((await battleHistory(prisma, bob.id))[0]!.result).toBe("loss");
  });

  it("plays a practice battle against the bot", async () => {
    const a = await client(alice);
    const start = once<{ battleId: string; opponent: { isBot: boolean }; questions: unknown[] }>(a, "battle:start");
    a.emit("queue:join", { vsBot: true });
    const s = await start;
    expect(s.opponent.isBot).toBe(true);
    const end = once<{ status: string }>(a, "battle:end");
    for (let i = 0; i < s.questions.length; i++) {
      const fb = once(a, "battle:feedback");
      a.emit("battle:answer", { battleId: s.battleId, index: i, answer: "x" });
      await fb;
    }
    expect((await end).status).toBe("FINISHED");
  });

  it("times out an empty queue and validates payloads", async () => {
    const a = await client(alice);
    const timeout = once<{ message: string }>(a, "queue:timeout");
    a.emit("queue:join", { courseId: "lonely" });
    expect((await timeout).message).toMatch(/LearnBot/);
    const err = once<{ message: string }>(a, "battle:error");
    a.emit("battle:answer", { nope: 1 });
    expect((await err).message).toBe("Invalid answer");
    const err2 = once<{ message: string }>(a, "battle:error");
    a.emit("battle:answer", { battleId: "missing", index: 0, answer: "a" });
    expect((await err2).message).toMatch(/not found/);
  });
});

describe("battle resilience: reconnects, forfeits and simultaneous answers", () => {
  const app = Fastify();
  let manager: BattleManager;
  let url: string;
  const sockets: Socket[] = [];
  const client = async (u: AuthUser) => {
    const s = connect(url, { auth: { token: await signSocketToken(u) }, transports: ["websocket"], forceNew: true, reconnection: false });
    sockets.push(s);
    await once(s, "connect");
    return s;
  };

  beforeAll(async () => {
    useFakeAi();
    if ((await prisma.question.count()) === 0) {
      const { lessons, instructor } = await seedCourse();
      await caller(instructor).quiz.generate({ lessonId: lessons[0]!.id, difficulty: 2, count: 5 });
    }
    await app.listen({ port: 0, host: "127.0.0.1" });
    manager = new BattleManager(app.server, prisma, ["*"], { perQuestionMs: 5000, botDelayScale: 50, reconnectGraceMs: 400, queueTimeoutMs: 2000 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await manager.close();
    await app.close();
  });

  it("a player who reconnects within the grace period resumes the battle", async () => {
    const u = await createUser();
    const a = await client(u);
    const start = once<{ battleId: string }>(a, "battle:start");
    a.emit("queue:join", { vsBot: true });
    const { battleId } = await start;
    const fb = once(a, "battle:feedback");
    a.emit("battle:answer", { battleId, index: 0, answer: "x" });
    await fb;
    a.disconnect();
    // Register the listener before the handshake completes: the server emits `battle:resume` on connect.
    const b = connect(url, { auth: { token: await signSocketToken(u) }, transports: ["websocket"], forceNew: true, reconnection: false });
    sockets.push(b);
    const resumed = await once<{ battleId: string; answered: number }>(b, "battle:resume");
    expect(resumed).toMatchObject({ battleId, answered: 1 });
    await new Promise((r) => setTimeout(r, 600)); // past the grace window: must NOT have been forfeited
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status).toBe("ACTIVE");
    b.disconnect();
  });

  it("a player who does not come back forfeits to the opponent", async () => {
    const [ua, ub] = [await createUser(), await createUser()];
    const a = await client(ua);
    const b = await client(ub);
    a.emit("queue:join", {});
    await once(a, "queue:waiting");
    const startB = once<{ battleId: string }>(b, "battle:start");
    b.emit("queue:join", {});
    const { battleId } = await startB;
    const warned = once<{ userId: string }>(b, "battle:opponent-disconnected");
    const ended = once<{ winnerId: string; status: string }>(b, "battle:end");
    a.disconnect();
    expect((await warned).userId).toBe(ua.id);
    expect(await ended).toMatchObject({ winnerId: ub.id, status: "ABANDONED" });
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).winnerId).toBe(ub.id);
    b.disconnect();
  });

  it("simultaneous answers are both scored and duplicates are rejected", async () => {
    const [ua, ub] = [await createUser(), await createUser()];
    const a = await client(ua);
    const b = await client(ub);
    a.emit("queue:join", {});
    await once(a, "queue:waiting");
    const startA = once<{ battleId: string }>(a, "battle:start");
    b.emit("queue:join", {});
    const { battleId } = await startA;
    const [fa, fbk] = [once(a, "battle:feedback"), once(b, "battle:feedback")];
    a.emit("battle:answer", { battleId, index: 0, answer: "true" });
    b.emit("battle:answer", { battleId, index: 0, answer: "true" });
    await Promise.all([fa, fbk]);
    const dup = once<{ message: string }>(a, "battle:error");
    a.emit("battle:answer", { battleId, index: 0, answer: "true" });
    expect((await dup).message).toMatch(/in order/);
    a.disconnect();
    b.disconnect();
  });
});
