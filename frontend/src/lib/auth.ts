"use client";
import { authFetch } from "./trpc";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "LEARNER" | "INSTRUCTOR" | "ADMIN";
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json as T;
}

export const authApi = {
  login: (email: string, password: string) => post<{ user: SessionUser }>("/api/auth/login", { email, password }),
  register: (data: { email: string; password: string; name: string; role?: "LEARNER" | "INSTRUCTOR" }) => post<{ user: SessionUser }>("/api/auth/register", data),
  magicLink: (email: string) => post<{ sent: boolean; devMailbox: boolean }>("/api/auth/magic-link", { email }),
  verifyMagic: (token: string) => post<{ user: SessionUser }>("/api/auth/magic-link/verify", { token }),
  devLogin: (email: string) => post<{ user: SessionUser }>("/api/auth/dev/login", { email }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),
  async session(): Promise<SessionUser | null> {
    const res = await authFetch("/api/auth/session");
    if (!res.ok) return null;
    const json = (await res.json()) as { user: SessionUser | null };
    if (json.user) return json.user;
    const refreshed = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (!refreshed.ok) return null;
    return ((await refreshed.json()) as { user: SessionUser }).user;
  },
  async mailbox(email: string) {
    const res = await fetch(`/api/auth/dev/mailbox?email=${encodeURIComponent(email)}`, { credentials: "include" });
    if (!res.ok) return [];
    return ((await res.json()) as { messages: { id: string; subject: string; link: string | null; createdAt: string }[] }).messages;
  },
  providers: async () => {
    const res = await fetch("/api/auth/providers");
    return res.ok ? ((await res.json()) as { oauth: ("google" | "github")[]; devLogin: boolean }) : { oauth: [], devLogin: false };
  },
};
