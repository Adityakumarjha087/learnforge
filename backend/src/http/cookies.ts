import type { FastifyReply } from "fastify";
import type { Session } from "../auth/service";
import { env } from "../config/env";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../trpc/trpc";

const base = () => ({ httpOnly: true, sameSite: "lax" as const, secure: env().COOKIE_SECURE, path: "/" });

export function setSessionCookies(reply: FastifyReply, session: Session): void {
  reply.setCookie(ACCESS_COOKIE, session.accessToken, { ...base(), maxAge: env().ACCESS_TOKEN_TTL_SEC });
  reply.setCookie(REFRESH_COOKIE, session.refreshToken, { ...base(), expires: session.refreshExpiresAt });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, base());
  reply.clearCookie(REFRESH_COOKIE, base());
}

export const sessionBody = (s: Session) => ({ user: s.user, accessToken: s.accessToken, expiresIn: env().ACCESS_TOKEN_TTL_SEC });
