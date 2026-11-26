import "@fastify/cookie";
import { initTRPC, TRPCError } from "@trpc/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import superjson from "superjson";
import { ZodError } from "zod";
import { hasRole, verifyAccessToken, type AuthUser, type Role } from "../auth/tokens";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import { getRedis } from "../lib/redis";

export const ACCESS_COOKIE = "lf_access";
export const REFRESH_COOKIE = "lf_refresh";

export interface Context {
  db: Db;
  user: AuthUser | null;
  ip: string;
}

export async function userFromRequest(req: FastifyRequest): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.[ACCESS_COOKIE];
  return token ? verifyAccessToken(token) : null;
}

export async function createContext({ req }: { req: FastifyRequest; res: FastifyReply }): Promise<Context> {
  return { db: prisma, user: await userFromRequest(req), ip: req.ip };
}

const CODE_MAP: Record<AppError["code"], TRPCError["code"]> = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  UNPROCESSABLE: "UNPROCESSABLE_CONTENT",
  INTERNAL: "INTERNAL_SERVER_ERROR",
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        stack: undefined,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
        appCode: error.cause instanceof AppError ? error.cause.code : null,
      },
    };
  },
});

/** Converts domain errors into tRPC errors and logs unexpected failures. */
const errorBoundary = t.middleware(async ({ next, path }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof AppError) {
      throw new TRPCError({ code: CODE_MAP[cause.code], message: cause.message, cause });
    }
    if (result.error.code === "INTERNAL_SERVER_ERROR") logger.error({ path, err: result.error }, "unhandled trpc error");
  }
  return result;
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(errorBoundary);

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const roleProcedure = (min: Role) =>
  protectedProcedure.use(({ ctx, next }) => {
    if (!hasRole(ctx.user, min)) throw new TRPCError({ code: "FORBIDDEN", message: `${min} role required` });
    return next();
  });

/** Sliding-window limiter for expensive AI procedures (Redis when available, in-memory otherwise). */
const memoryHits = new Map<string, number[]>();
export const aiRateLimited = (perMinute = 20) =>
  protectedProcedure.use(async ({ ctx, next, path }) => {
    const key = `rl:ai:${ctx.user.id}`;
    const redis = getRedis();
    let count: number;
    if (redis && redis.status === "ready") {
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
    } else {
      const now = Date.now();
      const hits = (memoryHits.get(key) ?? []).filter((t0) => now - t0 < 60_000);
      hits.push(now);
      memoryHits.set(key, hits);
      count = hits.length;
    }
    if (count > perMinute) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Too many AI requests (${path}); try again in a minute.` });
    return next();
  });
