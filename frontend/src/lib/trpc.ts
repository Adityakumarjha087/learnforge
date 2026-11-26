"use client";
import type { AppRouter } from "@backend/trpc/router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import superjson from "superjson";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
export type RouterOutputs = inferRouterOutputs<AppRouter>;

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh of the httpOnly access cookie using the rotating refresh token. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

/** fetch wrapper: on 401 transparently refresh once and retry. */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, credentials: "include" });
  if (res.status !== 401) return res;
  if (!(await refreshSession())) return res;
  return fetch(input, { ...init, credentials: "include" });
}

export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: authFetch, maxURLLength: 4000 })],
  });
}
