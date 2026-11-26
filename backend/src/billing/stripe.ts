import Stripe from "stripe";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { fromStripeStatus, type BillingSignal } from "./state-machine";

let client: Stripe | undefined;

/** Stripe API client - only available when a real STRIPE_SECRET_KEY is configured (otherwise billing runs in mock mode). */
export function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new AppError("INTERNAL", "Stripe is not configured (set STRIPE_SECRET_KEY or use BILLING_MODE=mock)");
  client ??= new Stripe(key);
  return client;
}

/** Offline webhook signature verification; needs only the webhook signing secret, never an API key. */
export function verifyWebhook(payload: Buffer | string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}

const toDate = (sec: unknown): Date | null => (typeof sec === "number" ? new Date(sec * 1000) : null);
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: unknown }).id) : null);

export interface MappedEvent {
  signal: BillingSignal;
  userId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
}

/** Translate a verified Stripe event into a provider-agnostic billing signal (null = ignored event type). */
export function mapStripeEvent(event: Stripe.Event): MappedEvent | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const periodEndOf = (o: Record<string, unknown>) => {
    const items = (o.items as { data?: { current_period_end?: number }[] } | undefined)?.data;
    return toDate(o.current_period_end) ?? toDate(items?.[0]?.current_period_end);
  };
  switch (event.type) {
    case "checkout.session.completed": {
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      return {
        signal: { type: "checkout.completed", periodEnd: new Date(Date.now() + 30 * 86_400_000) },
        userId: meta.userId ?? (obj.client_reference_id as string | null) ?? null,
        customerId: idOf(obj.customer),
        subscriptionId: idOf(obj.subscription),
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return {
        signal: {
          type: "subscription.updated",
          status: fromStripeStatus(String(obj.status)),
          periodEnd: periodEndOf(obj),
          cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        },
        userId: ((obj.metadata ?? {}) as Record<string, string>).userId ?? null,
        customerId: idOf(obj.customer),
        subscriptionId: idOf(obj.id),
      };
    case "customer.subscription.deleted":
      return { signal: { type: "subscription.deleted" }, userId: null, customerId: idOf(obj.customer), subscriptionId: idOf(obj.id) };
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const lines = (obj.lines as { data?: { period?: { end?: number } }[] } | undefined)?.data;
      return { signal: { type: "invoice.paid", periodEnd: toDate(lines?.[0]?.period?.end) }, userId: null, customerId: idOf(obj.customer), subscriptionId: null };
    }
    case "invoice.payment_failed":
      return { signal: { type: "invoice.payment_failed" }, userId: null, customerId: idOf(obj.customer), subscriptionId: null };
    default:
      return null;
  }
}
