import Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "../../src/auth/tokens";
import { caller, createUser, getApp, prisma, resetDb, seedCourse, useFakeAi } from "../helpers";
import { TEST_WEBHOOK_SECRET } from "../env";

const stripe = new Stripe(["sk", "test", "fixture"].join("_"));

function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK_SECRET });
  return { payload, headers: { "stripe-signature": header, "content-type": "application/json" } };
}

const evt = (id: string, type: string, object: Record<string, unknown>) => ({ id, object: "event", type, api_version: "2025-01-01", created: 1, data: { object } });

describe("tutor, code exercises, billing, analytics", () => {
  beforeAll(resetDb);
  beforeEach(() => {
    useFakeAi();
  });

  it("streams a grounded Socratic tutor reply and persists the conversation", async () => {
    const { courseId, lessons } = await seedCourse();
    const learner = await createUser();
    const session = await caller(learner).tutor.createSession({ courseId, lessonId: lessons[3]!.id });
    expect(session.title).toContain("Recursion");
    const app = await getApp();
    const token = await signAccessToken(learner);
    const res = await app.inject({
      method: "POST",
      url: "/api/tutor/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: session.id, messages: [{ role: "user", parts: [{ type: "text", text: "Why does a recursive function need a base case?" }] }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("_____");
    expect(res.body).not.toContain("<!--");
    const sources = JSON.parse(Buffer.from(String(res.headers["x-tutor-sources"]), "base64").toString());
    expect(sources.length).toBeGreaterThan(0);
    const history = await caller(learner).tutor.messages({ sessionId: session.id });
    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history.messages[1]!.content).not.toContain("<!--");
    expect((await caller(learner).tutor.sessions({ courseId })).length).toBe(1);

    const intruder = await createUser();
    await expect(caller(intruder).tutor.messages({ sessionId: session.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const empty = await app.inject({ method: "POST", url: "/api/tutor/chat", headers: { authorization: `Bearer ${token}` }, payload: { sessionId: session.id, messages: [] } });
    expect(empty.statusCode).toBe(400);
  });

  it("runs coding exercises in the sandbox with AI hints on failure", async () => {
    const { courseId, lessons } = await seedCourse();
    const ex = await prisma.codeExercise.create({
      data: {
        courseId,
        lessonId: lessons[3]!.id,
        title: "Factorial",
        prompt: "Write factorial(n)",
        entrypoint: "factorial",
        starterCode: "function factorial(n) {}",
        solution: "function factorial(n){return n<=1?1:n*factorial(n-1)}",
        tests: [
          { args: "[0]", expected: "1" },
          { args: "[5]", expected: "120" },
        ],
      },
    });
    const learner = await createUser();
    const api = caller(learner);
    const view = await api.code.get({ id: ex.id });
    expect(view).not.toHaveProperty("solution");
    const fail = await api.code.run({ id: ex.id, code: "function factorial(n){ return n * factorial(n - 1) }" });
    expect(fail.passed).toBe(false);
    expect(fail.hint).toBeTruthy();
    const pass = await api.code.run({ id: ex.id, code: "function factorial(n){ return n <= 1 ? 1 : n * factorial(n - 1) }" });
    expect(pass.passed).toBe(true);
    expect(pass.award?.xp).toBe(30);
    expect(pass.award?.newBadges).toContain("coder");
    const again = await api.code.run({ id: ex.id, code: "function factorial(n){ return n <= 1 ? 1 : n * factorial(n - 1) }" });
    expect(again.award).toBeNull();
    expect((await api.code.list({ courseId }))[0]!.solved).toBe(true);
    expect((await api.code.get({ id: ex.id })).solved).toBe(true);
  });

  it("mock billing exercises the subscription state machine", async () => {
    const user = await createUser();
    const api = caller(user);
    expect((await api.billing.status()).status).toBe("NONE");
    const { url } = await api.billing.checkout();
    expect(url).toContain("/billing/mock-checkout?session=mock_cs_");
    await api.billing.mock({ action: "checkout" });
    expect(await api.billing.status()).toMatchObject({ status: "ACTIVE", pro: true });
    await api.billing.mock({ action: "payment_failed" });
    expect(await api.billing.status()).toMatchObject({ status: "PAST_DUE", pro: true });
    await api.billing.mock({ action: "payment_succeeded" });
    await api.billing.cancel();
    expect(await api.billing.status()).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true });
    await api.billing.mock({ action: "resume" });
    await api.billing.mock({ action: "delete" });
    expect(await api.billing.status()).toMatchObject({ status: "CANCELED", pro: false });
  });

  it("verifies signed Stripe webhook fixtures and is idempotent", async () => {
    const app = await getApp();
    const user = await createUser();
    const inject = (e: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/billing/webhook", ...signed(e) });

    const checkout = evt("evt_checkout_1", "checkout.session.completed", { object: "checkout.session", client_reference_id: user.id, metadata: { userId: user.id }, customer: "cus_123", subscription: "sub_123" });
    expect((await inject(checkout)).json()).toMatchObject({ applied: true, status: "ACTIVE" });
    expect((await inject(checkout)).json()).toMatchObject({ applied: false }); // duplicate delivery

    expect((await inject(evt("evt_fail_1", "invoice.payment_failed", { object: "invoice", customer: "cus_123" }))).json().status).toBe("PAST_DUE");
    expect((await inject(evt("evt_paid_1", "invoice.paid", { object: "invoice", customer: "cus_123", lines: { data: [{ period: { end: 1_900_000_000 } }] } }))).json().status).toBe("ACTIVE");
    const upd = await inject(evt("evt_upd_1", "customer.subscription.updated", { object: "subscription", id: "sub_123", customer: "cus_123", status: "active", cancel_at_period_end: true, items: { data: [{ current_period_end: 1_900_000_000 }] } }));
    expect(upd.json().status).toBe("ACTIVE");
    expect((await inject(evt("evt_del_1", "customer.subscription.deleted", { object: "subscription", id: "sub_123", customer: "cus_123" }))).json().status).toBe("CANCELED");
    expect((await inject(evt("evt_other", "charge.refunded", { object: "charge" }))).json()).toMatchObject({ ignored: "charge.refunded" });

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(sub).toMatchObject({ status: "CANCELED", provider: "stripe", customerId: "cus_123" });

    const tampered = signed(checkout);
    const bad = await app.inject({ method: "POST", url: "/api/billing/webhook", payload: tampered.payload.replace("cus_123", "cus_666"), headers: tampered.headers });
    expect(bad.statusCode).toBe(400);
    const unsigned = await app.inject({ method: "POST", url: "/api/billing/webhook", payload: "{}", headers: { "content-type": "application/json" } });
    expect(unsigned.statusCode).toBe(400);
    // Unknown customer: recorded but not applied.
    expect((await inject(evt("evt_orphan", "invoice.payment_failed", { object: "invoice", customer: "cus_nobody" }))).json()).toMatchObject({ applied: false });
  });

  it("instructor analytics reports completion, weak concepts and item difficulty", async () => {
    const { courseId, lessons, instructor } = await seedCourse();
    const quiz = await caller(instructor).quiz.generate({ lessonId: lessons[0]!.id, difficulty: 2, count: 4 });
    const questions = await prisma.question.findMany({ where: { quizId: quiz.quizId } });
    for (const skill of [1, 0]) {
      const learner = await createUser();
      await caller(learner).course.enroll({ id: courseId });
      await caller(learner).course.completeLesson({ lessonId: lessons[0]!.id });
      await caller(learner).quiz.submit({ id: quiz.quizId, answers: questions.map((q) => ({ questionId: q.id, answer: skill ? q.answer : "nope" })) });
    }
    const a = await caller(instructor).instructor.analytics({ courseId });
    expect(a.summary.learners).toBe(2);
    expect(a.summary.quizAttempts).toBe(2);
    expect(a.summary.avgQuizScore).toBeGreaterThan(0);
    expect(a.lessonCompletion[0]!.rate).toBe(1);
    expect(a.weakConcepts.length).toBeGreaterThan(0);
    expect(a.hardestItems[0]!.pCorrect).toBeLessThanOrEqual(0.5);
    expect(a.learners).toHaveLength(2);
    const overview = await caller(instructor).instructor.overview();
    expect(overview.find((c) => c.id === courseId)?.enrollments).toBe(2);
    const otherInstructor = await createUser("INSTRUCTOR");
    await expect(caller(otherInstructor).instructor.analytics({ courseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("profile, dashboard and leaderboards", async () => {
    const u = await createUser();
    const api = caller(u);
    const dash = await api.me.dashboard();
    expect(dash.me.level.level).toBeGreaterThanOrEqual(1);
    expect(dash.me.badges.length).toBe(9);
    expect((await api.me.socketToken()).token).toBeTruthy();
    const week = await api.gamification.leaderboard({ period: "week" });
    const all = await api.gamification.leaderboard({ period: "all" });
    expect(all[0]!.rank).toBe(1);
    expect(week.every((r, i, arr) => i === 0 || arr[i - 1]!.score >= r.score)).toBe(true);
    expect(await api.gamification.battles()).toEqual([]);
  });
});
