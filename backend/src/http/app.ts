import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply } from "fastify";
import { ZodError } from "zod";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { getRedis } from "../lib/redis";
import { appRouter, type AppRouter } from "../trpc/router";
import { createContext } from "../trpc/trpc";
import { buildOpenApi } from "./openapi";
import { authRoutes } from "./routes/auth";
import { contentRoutes } from "./routes/content";

export function corsOrigins(): string[] {
  const extra = env().CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  return [env().APP_URL, ...extra];
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: Math.round(env().UPLOAD_MAX_MB * 1024 * 1024),
    routerOptions: { maxParamLength: 5000 },
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(cors, { origin: corsOrigins(), credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: env().UPLOAD_MAX_MB * 1024 * 1024, files: 1 } });
  const redis = getRedis();
  await app.register(rateLimit, {
    global: true,
    max: env().RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    ...(redis ? { redis, nameSpace: "learnforge-rl:" } : {}),
    skipOnError: true,
    allowList: (req) => req.url === "/health" || req.url === "/api/health",
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Validation failed", details: err.flatten() } });
    const e = err as { statusCode?: number; message?: string; code?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "unhandled error");
    return reply.status(status).send({ error: { code: status === 429 ? "TOO_MANY_REQUESTS" : (e.code ?? "INTERNAL"), message: status >= 500 ? "Internal server error" : e.message } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` } }));

  const health = async (_req: unknown, reply: FastifyReply) => {
    const checks: Record<string, string> = { db: "down", redis: redis ? "down" : "disabled" };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = "up";
    } catch {
      /* reported below */
    }
    if (redis) {
      try {
        checks.redis = (await redis.ping()) === "PONG" ? "up" : "down";
      } catch {
        /* reported below */
      }
    }
    const ok = checks.db === "up";
    return reply.status(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", ...checks, llm: env().LLM_PROVIDER, uptimeSec: Math.round(process.uptime()) });
  };
  app.get("/health", health);
  app.get("/api/health", health);

  await app.register(swagger, { mode: "static", specification: { document: buildOpenApi() as never } });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(contentRoutes, { prefix: "/api" });
  await app.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError: ({ path, error }) => {
        if (error.code === "INTERNAL_SERVER_ERROR") logger.error({ path, err: error.cause ?? error }, "trpc internal error");
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  return app;
}
