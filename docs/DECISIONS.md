# Engineering decisions & scope notes

This file records deliberate trade-offs, deviations from the original brief, and where depth was cut
(never correctness).

## Architecture

| Decision | Why |
|---|---|
| **Fastify + tRPC v11 backend, separate from Next.js** | The brief asks for a Node/tRPC backend. Keeping it a standalone service lets the same process host Socket.IO battles, raw-body Stripe webhooks, multipart uploads and the streaming tutor endpoint, which are awkward inside Next route handlers. The frontend imports only the router **type** (`@backend/trpc/router`), so there is end-to-end type safety with no shared runtime code. |
| **Same-origin API proxy** (`/api/*` rewrite in Next) | Auth uses httpOnly cookies; proxying keeps cookies first-party and avoids CORS in the browser. Socket.IO connects to the API directly with a 5-minute *socket token* (separate JWT audience) because Next rewrites do not proxy WebSockets. |
| **superjson transformer** | Dates and other non-JSON types survive the wire, so `RouterOutputs` types are honest on the client. |
| **pgvector inside PostgreSQL** | One datastore for relational + vector data; HNSW index on `Chunk.embedding`. Retrieval is scoped by course and boosts chunks from the current lesson. |

## Auth — NextAuth replaced by first-party JWT auth

The brief names NextAuth (Google + GitHub + magic link). NextAuth's session lives in the Next.js app,
but here the **API** is the security boundary and also has to authenticate tRPC, uploads, the streaming
tutor and Socket.IO. Bridging NextAuth's encrypted session cookie into a separate service adds a
second token format for little benefit, so the API implements the same feature set itself:

- credentials (bcrypt) + **email magic links** (single-use, 15 min, hashed at rest; with no SMTP the
  message goes to a dev outbox exposed at `/api/auth/dev/mailbox` when `DEV_LOGIN_ENABLED=true`)
- **Google and GitHub OAuth** (authorization-code flow with a state cookie; buttons appear only when
  client credentials are configured). Unit-tested with mocked provider responses; not exercised against
  real OAuth apps because none were available.
- short-lived access JWT (15 min) + **rotating refresh tokens with reuse detection** (replaying a rotated
  token revokes the whole token family)
- RBAC: `LEARNER < INSTRUCTOR < ADMIN`. Anyone may generate private courses for themselves; publishing to
  the catalog and analytics require INSTRUCTOR; ownership checks on every mutation (IDOR tests included).

## AI layer

- One `LLMProvider` interface; `LLM_PROVIDER` selects `fake | anthropic | openai | gemini | ollama`.
- **Anthropic** uses the official `@anthropic-ai/sdk` (`beta.messages.parse` with a Zod output format and
  `beta.messages.stream`), default model `claude-opus-5-5`, with server-side refusal fallbacks enabled.
  OpenAI/Gemini/Ollama go through the Vercel AI SDK (`generateText` + `Output.object`, `streamText`).
- Every structured output is re-validated with Zod regardless of provider; invalid output is repaired
  (JSON in strings / code fences) or retried once with the validation errors, then surfaced as a clean 422.
  Failed generations are not counted against quotas.
- **Offline fake provider (default)** — deterministic, schema-valid courses, quizzes, flashcards, grading,
  judge reports, code hints and Socratic tutor replies built from the lesson text. It injects a
  configurable rate of wrong MCQ answer keys (15% outside tests) so the LLM-as-judge gate has real work
  to do in demos. Real-provider paths are covered by tests with mocked SDK clients only (no API keys).
- **Quality gate**: LLM-as-judge verdicts + deterministic checks (answer ∈ options, grounding of the keyed
  answer in the source) + the reference solution of every code question must pass its own tests in the
  sandbox. Rejected items are dropped and recorded in `Quiz.judgeReport`; fewer than 3 valid items ⇒ REJECTED.
- **Prompt injection**: all user-controlled text is fenced in tags marked as untrusted data, closing tags are
  stripped from the payload, injection-looking lines are removed from uploads, and the tutor declines
  jailbreak requests (tested).
- Embeddings: offline 256-d feature-hashing embedder by default; OpenAI `text-embedding-3-small` at 256 dims
  when configured (same column width).

## Learning science

- **FSRS-4.5** implemented from the published formulas (default 17 weights, 90% target retention,
  learning/relearning steps in minutes). SM-2 is implemented too and selectable via `SRS_ALGORITHM=sm2`.
- **Mastery** = Bayesian Knowledge Tracing per concept (guess probability depends on item format) plus an
  Elo rating for learners and items. Next-lesson recommendations remediate the weakest completed concept
  (P(known) < 0.4 after ≥ 2 attempts) before continuing; quiz difficulty targets mastery bands, and item
  ratings are updated from responses.
- Flashcard recall also feeds BKT. Duplicate review submissions within 2 s are ignored (idempotent).

## Sandbox

Piston is heavy (privileged container + runtime downloads), so it sits behind the `sandbox` compose
profile. The default runner is **QuickJS compiled to WebAssembly** running in-process: no Node APIs,
filesystem or network, a 32 MB memory limit, stack limit, wall-clock interrupt, capped stdout/return
values, and a **fresh WASM module per run** (an earlier shared-module design could abort after
pathological programs). User code is never executed on the host. Python exercises require Piston.

## Billing

`BILLING_MODE=mock` (default) and Stripe share one pure subscription state machine
(`NONE → ACTIVE/TRIALING → PAST_DUE ↔ ACTIVE → CANCELED`, cancel-at-period-end, 7-day dunning grace).
The Stripe webhook verifies signatures with `Stripe.webhooks.constructEvent` (no API key needed) and is
idempotent via a `BillingEvent` table; tests sign fixture events at runtime (stale/invalid signatures are
rejected). A Stripe API client is only constructed when a real `STRIPE_SECRET_KEY` is configured.
Free plan: 10 AI generations/month (course, quiz, flashcards) and 40 tutor messages/day; Pro: 500/month.

## Realtime battles

Socket.IO with an authoritative in-memory `Battle` engine (scoring = 100 + up to 50 speed bonus).
Matchmaking queue per course, practice bot, 10 s reconnect grace (rejoin resumes the battle), forfeit on
timeout. **Scope cut:** battle state is per API instance (no Redis adapter), so horizontal scaling of the
API would need sticky sessions or the Socket.IO Redis adapter + shared battle state.

## Other cuts / known limitations

- TipTap editor round-trips Markdown via `@tiptap/markdown`; KaTeX/Mermaid are rendered in the lesson
  view, not live inside the editor.
- The code editor is a lightweight textarea (no Monaco) to keep bundles small.
- Instructor analytics are computed on read (fine for demo scale; would move to materialized views).
- Rate limiting is per-IP globally (Redis-backed) plus per-user sliding windows for AI procedures; the
  per-user window falls back to memory when Redis is unavailable.
