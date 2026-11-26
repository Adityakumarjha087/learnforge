import { z } from "zod";
import { appRouter } from "../trpc/router";

type JsonSchema = Record<string, unknown>;

interface ProcedureDef {
  type: "query" | "mutation" | "subscription";
  inputs: unknown[];
}

const toSchema = (inputs: unknown[]): JsonSchema | null => {
  const zodInput = inputs.find((i): i is z.ZodType => i instanceof z.ZodType);
  if (!zodInput) return null;
  try {
    return z.toJSONSchema(zodInput, { unrepresentable: "any", io: "input" }) as JsonSchema;
  } catch {
    return { type: "object" };
  }
};

const restPaths: Record<string, unknown> = {
  "/health": { get: { tags: ["system"], summary: "Liveness/readiness (DB + Redis)", responses: { 200: { description: "Healthy" }, 503: { description: "Degraded" } } } },
  "/api/auth/register": {
    post: {
      tags: ["auth"],
      summary: "Register with email + password (sets httpOnly access/refresh cookies)",
      requestBody: { content: { "application/json": { schema: { type: "object", required: ["email", "password", "name"], properties: { email: { type: "string" }, password: { type: "string", minLength: 8 }, name: { type: "string" }, role: { enum: ["LEARNER", "INSTRUCTOR"] } } } } } },
      responses: { 200: { description: "Session created" }, 409: { description: "Email taken" } },
    },
  },
  "/api/auth/login": {
    post: {
      tags: ["auth"],
      summary: "Credentials login",
      requestBody: { content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string" }, password: { type: "string" } } } } } },
      responses: { 200: { description: "Session created" }, 401: { description: "Invalid credentials" } },
    },
  },
  "/api/auth/magic-link": { post: { tags: ["auth"], summary: "Request an email magic link (dev: delivered to /api/auth/dev/mailbox)", responses: { 200: { description: "Sent" } } } },
  "/api/auth/magic-link/verify": { post: { tags: ["auth"], summary: "Exchange a magic-link token for a session", responses: { 200: { description: "Session created" } } } },
  "/api/auth/refresh": { post: { tags: ["auth"], summary: "Rotate the refresh token (reuse detection revokes the token family)", responses: { 200: { description: "Rotated" } } } },
  "/api/auth/logout": { post: { tags: ["auth"], summary: "Revoke the refresh token and clear cookies", responses: { 200: { description: "Signed out" } } } },
  "/api/auth/session": { get: { tags: ["auth"], summary: "Current user (or null)", responses: { 200: { description: "Session" } } } },
  "/api/auth/dev/login": { post: { tags: ["auth"], summary: "Dev only: one-click demo login by email", responses: { 200: { description: "Session created" } } } },
  "/api/auth/dev/mailbox": { get: { tags: ["auth"], summary: "Dev only: read the local email outbox", parameters: [{ name: "email", in: "query", required: true, schema: { type: "string" } }], responses: { 200: { description: "Messages" } } } },
  "/api/auth/oauth/{provider}": { get: { tags: ["auth"], summary: "Start Google/GitHub OAuth", parameters: [{ name: "provider", in: "path", required: true, schema: { enum: ["google", "github"] } }], responses: { 302: { description: "Redirect" } } } },
  "/api/uploads": { post: { tags: ["content"], summary: "Upload a PDF/notes file (multipart field `file`) for course generation", responses: { 200: { description: "Document created" } } } },
  "/api/tutor/chat": {
    post: {
      tags: ["tutor"],
      summary: "Stream a Socratic tutor reply (text/plain stream, AI SDK text transport compatible)",
      requestBody: { content: { "application/json": { schema: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" }, message: { type: "string" } } } } } },
      responses: { 200: { description: "Streamed text" } },
    },
  },
  "/api/billing/webhook": { post: { tags: ["billing"], summary: "Stripe webhook (signature verified)", responses: { 200: { description: "Processed" }, 400: { description: "Bad signature" } } } },
};

/** OpenAPI 3.1 document: hand-described REST routes + every tRPC procedure generated from its Zod input. */
export function buildOpenApi(): Record<string, unknown> {
  const procedures = (appRouter._def as unknown as { procedures: Record<string, { _def: ProcedureDef }> }).procedures;
  const trpcPaths: Record<string, unknown> = {};
  for (const [path, proc] of Object.entries(procedures).sort(([a], [b]) => a.localeCompare(b))) {
    const schema = toSchema(proc._def.inputs);
    const tag = path.split(".")[0];
    const common = { tags: [`trpc:${tag}`], operationId: path, summary: `tRPC ${proc._def.type} \`${path}\``, security: [{ cookieAuth: [] }, { bearerAuth: [] }], responses: { 200: { description: "tRPC result envelope `{ result: { data: { json } } }` (superjson)" } } };
    trpcPaths[`/api/trpc/${path}`] =
      proc._def.type === "query"
        ? { get: { ...common, parameters: schema ? [{ name: "input", in: "query", description: "superjson-encoded input, e.g. {\"json\":{...}}", content: { "application/json": { schema } } }] : [] } }
        : { post: { ...common, requestBody: schema ? { content: { "application/json": { schema } } } : undefined } };
  }
  return {
    openapi: "3.1.0",
    info: { title: "LearnForge API", version: "1.0.0", description: "Adaptive learning platform API. Business logic is exposed via tRPC (documented below); auth, uploads, streaming and webhooks are REST." },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "lf_access" },
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    paths: { ...restPaths, ...trpcPaths },
  };
}
