import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { randomToken } from "../lib/crypto";
import type { Db } from "../lib/prisma";
import { INITIAL_STATE, isPro, transition, type BillingSignal, type SubState } from "./state-machine";
import { stripe } from "./stripe";

export interface ApplyEventInput {
  eventId: string;
  provider: "mock" | "stripe";
  signal: BillingSignal;
  userId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}

async function resolveUserId(db: Db, input: ApplyEventInput): Promise<string | null> {
  if (input.userId) return input.userId;
  if (input.customerId) {
    const sub = await db.subscription.findUnique({ where: { customerId: input.customerId } });
    if (sub) return sub.userId;
  }
  if (input.subscriptionId) {
    const sub = await db.subscription.findUnique({ where: { subscriptionId: input.subscriptionId } });
    if (sub) return sub.userId;
  }
  return null;
}

/** Idempotently apply a billing event to the user's subscription through the state machine. */
export async function applyBillingEvent(db: Db, input: ApplyEventInput): Promise<{ applied: boolean; state?: SubState }> {
  try {
    await db.billingEvent.create({ data: { id: input.eventId, type: input.signal.type, provider: input.provider } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { applied: false };
    throw err;
  }
  const userId = await resolveUserId(db, input);
  if (!userId) return { applied: false };
  const current = await db.subscription.findUnique({ where: { userId } });
  const prev: SubState = current
    ? { status: current.status, currentPeriodEnd: current.currentPeriodEnd, cancelAtPeriodEnd: current.cancelAtPeriodEnd }
    : INITIAL_STATE;
  const next = transition(prev, input.signal);
  const data = {
    status: next.status,
    currentPeriodEnd: next.currentPeriodEnd,
    cancelAtPeriodEnd: next.cancelAtPeriodEnd,
    provider: input.provider,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
  };
  await db.subscription.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return { applied: true, state: next };
}

export async function subscriptionState(db: Db, userId: string) {
  const sub = await db.subscription.findUnique({ where: { userId } });
  const state: SubState = sub ? { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd } : INITIAL_STATE;
  return { ...state, provider: sub?.provider ?? env().BILLING_MODE, pro: isPro(state), mode: env().BILLING_MODE };
}

export async function createCheckout(db: Db, user: { id: string; email: string }): Promise<{ url: string }> {
  const e = env();
  if (e.BILLING_MODE === "mock") {
    const session = `mock_cs_${randomToken(10)}`;
    return { url: `${e.APP_URL}/billing/mock-checkout?session=${session}` };
  }
  if (!e.STRIPE_SECRET_KEY || !e.STRIPE_PRICE_PRO) throw new AppError("INTERNAL", "Stripe is not configured");
  const existing = await db.subscription.findUnique({ where: { userId: user.id } });
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: e.STRIPE_PRICE_PRO, quantity: 1 }],
    client_reference_id: user.id,
    metadata: { userId: user.id },
    subscription_data: { metadata: { userId: user.id } },
    ...(existing?.customerId ? { customer: existing.customerId } : { customer_email: user.email }),
    success_url: `${e.APP_URL}/billing?status=success`,
    cancel_url: `${e.APP_URL}/billing?status=cancelled`,
  });
  if (!session.url) throw new AppError("INTERNAL", "Stripe did not return a checkout URL");
  return { url: session.url };
}

/** Mock mode only: emulate the provider by emitting the same signals a real checkout/webhook would. */
export async function mockSignal(db: Db, userId: string, kind: "checkout" | "payment_failed" | "payment_succeeded" | "cancel" | "resume" | "delete") {
  if (env().BILLING_MODE !== "mock") throw new AppError("FORBIDDEN", "Mock billing is disabled");
  const periodEnd = new Date(Date.now() + 30 * 86_400_000);
  const current = await subscriptionState(db, userId);
  const signal: BillingSignal = (() => {
    switch (kind) {
      case "checkout":
        return { type: "checkout.completed", periodEnd };
      case "payment_failed":
        return { type: "invoice.payment_failed" };
      case "payment_succeeded":
        return { type: "invoice.paid", periodEnd };
      case "cancel":
        return { type: "subscription.updated", status: current.status === "NONE" ? "NONE" : current.status, periodEnd: current.currentPeriodEnd, cancelAtPeriodEnd: true };
      case "resume":
        return { type: "subscription.updated", status: current.status, periodEnd: current.currentPeriodEnd, cancelAtPeriodEnd: false };
      case "delete":
        return { type: "subscription.deleted" };
    }
  })();
  return applyBillingEvent(db, {
    eventId: `mock_evt_${randomToken(10)}`,
    provider: "mock",
    signal,
    userId,
    ...(kind === "checkout" ? { customerId: `mock_cus_${userId}`, subscriptionId: `mock_sub_${userId}` } : {}),
  });
}

export async function cancelSubscription(db: Db, userId: string) {
  if (env().BILLING_MODE === "mock") return mockSignal(db, userId, "cancel");
  const sub = await db.subscription.findUnique({ where: { userId } });
  if (!sub?.subscriptionId) throw new AppError("NOT_FOUND", "No active subscription");
  await stripe().subscriptions.update(sub.subscriptionId, { cancel_at_period_end: true });
  return { applied: true };
}
