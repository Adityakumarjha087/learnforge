import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { mapStripeEvent } from "../../billing/stripe";
import { applyBillingEvent } from "../../billing/service";
import { stripe } from "../../billing/stripe";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { extractUploadText } from "../../rag/ingest";
import { tutorTurn } from "../../services/tutor";
import { userFromRequest } from "../../trpc/trpc";

/** Accepts either `{ sessionId, message }` or the AI SDK chat transport body (`{ sessionId, messages: UIMessage[] }`). */
const ChatSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().max(4000).optional(),
  messages: z
    .array(z.object({ role: z.string(), parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(), content: z.string().optional() }))
    .optional(),
});

function lastUserText(body: z.infer<typeof ChatSchema>): string {
  if (body.message) return body.message;
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  const text = last?.content ?? last?.parts?.filter((p) => p.type === "text").map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new AppError("BAD_REQUEST", "Message is empty");
  return text.slice(0, 4000);
}

export async function contentRoutes(app: FastifyInstance) {
  app.post("/uploads", async (req) => {
    const user = await userFromRequest(req);
    if (!user) throw new AppError("UNAUTHORIZED", "Sign in required");
    const file = await req.file();
    if (!file) throw new AppError("BAD_REQUEST", "Attach a file in the `file` field");
    const buffer = await file.toBuffer();
    const text = await extractUploadText(buffer, file.mimetype, file.filename);
    const doc = await prisma.document.create({ data: { ownerId: user.id, filename: file.filename.slice(0, 200), mimeType: file.mimetype, text } });
    return { documentId: doc.id, filename: doc.filename, characters: text.length, preview: text.slice(0, 400) };
  });

  app.post("/tutor/chat", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) throw new AppError("UNAUTHORIZED", "Sign in required");
    const body = ChatSchema.parse(req.body);
    const controller = new AbortController();
    req.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    const turn = await tutorTurn(prisma, user, body.sessionId, lastUserText(body), controller.signal);
    reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("cache-control", "no-cache, no-transform")
      .header("x-accel-buffering", "no")
      .header("x-tutor-sources", Buffer.from(JSON.stringify(turn.sources)).toString("base64"));
    return reply.send(Readable.from(turn.stream));
  });

  // Stripe webhooks need the raw body for signature verification.
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/billing/webhook", async (req, reply) => {
      const secret = env().STRIPE_WEBHOOK_SECRET;
      if (!secret) throw new AppError("NOT_FOUND", "Stripe webhooks are not configured");
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") throw new AppError("BAD_REQUEST", "Missing stripe-signature header");
      let event;
      try {
        event = stripe().webhooks.constructEvent(req.body as Buffer, signature, secret);
      } catch (err) {
        logger.warn({ err: (err as Error).message }, "stripe signature verification failed");
        throw new AppError("BAD_REQUEST", "Invalid webhook signature");
      }
      const mapped = mapStripeEvent(event);
      if (!mapped) return reply.send({ received: true, ignored: event.type });
      const result = await applyBillingEvent(prisma, { eventId: event.id, provider: "stripe", ...mapped });
      return reply.send({ received: true, applied: result.applied, status: result.state?.status ?? null });
    });
  });
}
