/**
 * Subscription state machine shared by the mock billing mode and the Stripe webhook handler.
 * Pure and provider-agnostic: provider payloads are first mapped to BillingSignal.
 */
export type SubStatus = "NONE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";

export interface SubState {
  status: SubStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type BillingSignal =
  | { type: "checkout.completed"; periodEnd: Date; trial?: boolean }
  | { type: "subscription.updated"; status: SubStatus; periodEnd: Date | null; cancelAtPeriodEnd: boolean }
  | { type: "invoice.paid"; periodEnd: Date | null }
  | { type: "invoice.payment_failed" }
  | { type: "subscription.deleted" };

export const INITIAL_STATE: SubState = { status: "NONE", currentPeriodEnd: null, cancelAtPeriodEnd: false };

export class InvalidTransitionError extends Error {}

/** Returns the next state. Signals that are meaningless in the current state are ignored (idempotent no-ops). */
export function transition(state: SubState, signal: BillingSignal): SubState {
  switch (signal.type) {
    case "checkout.completed":
      return { status: signal.trial ? "TRIALING" : "ACTIVE", currentPeriodEnd: signal.periodEnd, cancelAtPeriodEnd: false };
    case "subscription.updated":
      if (state.status === "CANCELED" && signal.status !== "ACTIVE" && signal.status !== "TRIALING") return state;
      return { status: signal.status, currentPeriodEnd: signal.periodEnd ?? state.currentPeriodEnd, cancelAtPeriodEnd: signal.cancelAtPeriodEnd };
    case "invoice.paid":
      if (state.status === "NONE" || state.status === "CANCELED") return state;
      return { ...state, status: "ACTIVE", currentPeriodEnd: signal.periodEnd ?? state.currentPeriodEnd };
    case "invoice.payment_failed":
      if (state.status !== "ACTIVE" && state.status !== "TRIALING" && state.status !== "PAST_DUE") return state;
      return { ...state, status: "PAST_DUE" };
    case "subscription.deleted":
      if (state.status === "NONE") return state;
      return { ...state, status: "CANCELED", cancelAtPeriodEnd: false };
  }
}

/** Pro entitlement. PAST_DUE keeps access during dunning (grace period). */
export function isPro(state: SubState, now: Date = new Date()): boolean {
  switch (state.status) {
    case "ACTIVE":
    case "TRIALING":
      return !state.currentPeriodEnd || state.currentPeriodEnd > now || !state.cancelAtPeriodEnd;
    case "PAST_DUE":
      return !!state.currentPeriodEnd && now.getTime() < state.currentPeriodEnd.getTime() + 7 * 86_400_000;
    default:
      return false;
  }
}

/** Map Stripe subscription.status values onto our states. */
export function fromStripeStatus(status: string): SubStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return "NONE";
  }
}
