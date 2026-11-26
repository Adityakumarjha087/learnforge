# LearnForge — AI Adaptive Learning Platform with a Personal Tutor

LearnForge turns a topic prompt or your own study material (PDF / Markdown / text) into a structured
course — syllabus → modules → lessons with worked examples, math and diagrams — and then keeps adapting
to you: quizzes are generated at the difficulty your mastery calls for and checked by an LLM-as-judge,
flashcards are scheduled with FSRS, a Socratic tutor grounded in the course (RAG over pgvector) guides
you with hints instead of answers, coding exercises run in a sandbox, and XP, streaks, badges and
real-time 1v1 quiz battles keep you coming back. Instructors publish courses and see where learners
struggle. Free vs Pro plans meter AI usage.

It runs **fully offline with zero API keys**: a deterministic fake LLM, a hashing embedder, a WASM code
sandbox, dev magic-link mailbox and mock billing are the defaults. Real providers are one env var away.

## Features

| # | Feature | Status |
|---|---|---|
| 1 | Course from a topic or uploaded PDF/notes: syllabus → modules → lessons (Markdown + KaTeX + Mermaid + code) | ✅ |
| 2 | Auto-generated quizzes — MCQ, true/false, short answer (AI-graded with feedback), code questions (sandbox-graded) | ✅ |
| 3 | Flashcards with **FSRS-4.5** scheduling (SM-2 selectable) and a daily review queue + 7-day forecast | ✅ |
| 4 | Mastery per concept (**Bayesian Knowledge Tracing + Elo**); next lesson and quiz difficulty adapt | ✅ |
| 5 | **Socratic tutor** chat, streamed (Vercel AI SDK), grounded via pgvector RAG, KaTeX + code blocks, jailbreak-resistant | ✅ |
| 6 | Coding exercises in a sandbox (QuickJS-WASM default, Piston via compose profile) with AI hints on failure | ✅ |
| 7 | Gamification: XP, levels, streaks, 9 badges, weekly/all-time leaderboard, **real-time 1v1 battles** (Socket.IO) + practice bot | ✅ |
| 8 | Instructor mode: create/edit (TipTap) and publish courses; analytics (completion funnel, weak concepts, hardest items, learners) | ✅ |
| 9 | Stripe subscriptions (free vs pro) with usage limits on AI generations — mock mode uses the same state machine | ✅ |
| 10 | Content quality gate: LLM-as-judge + deterministic checks + reference solutions executed before a quiz is published | ✅ |
| — | Auth: credentials, email magic link, Google/GitHub OAuth (when configured), JWT + rotating refresh tokens, RBAC | ✅ |

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI["Next.js 15 app<br/>React 19 · Tailwind · shadcn-style UI<br/>TanStack Query + tRPC client<br/>AI SDK useChat · Socket.IO client"]
  end
  subgraph Web["web (Next.js, :21000)"]
    RW["/api/* rewrite<br/>(same-origin cookies)"]
  end
  subgraph API["api (Fastify, :21001)"]
    TRPC["tRPC v11 routers<br/>(Zod-validated)"]
    REST["REST: auth · uploads ·<br/>tutor stream · Stripe webhook · OpenAPI"]
    WS["Socket.IO battles"]
    SVC["Services: courses · quizzes · FSRS · BKT/Elo ·<br/>tutor RAG · sandbox · billing state machine · XP"]
    AI["LLM facade<br/>fake | Anthropic SDK | OpenAI/Gemini/Ollama (AI SDK)"]
    SB["Sandbox<br/>QuickJS WASM | Piston"]
  end
  PG[("PostgreSQL 16<br/>+ pgvector (HNSW)")]
  RD[("Redis<br/>rate limits")]
  PI["piston (profile: sandbox)"]
  UI --> RW --> TRPC & REST
  UI -- websocket --> WS
  TRPC & REST & WS --> SVC --> AI
  SVC --> SB -.-> PI
  SVC --> PG
  REST --> RD
```

```mermaid
sequenceDiagram
  participant L as Learner
  participant Q as quiz.adaptive
  participant M as Mastery (BKT+Elo)
  participant G as Generator LLM
  participant J as Judge LLM + sandbox
  L->>Q: Take adaptive quiz
  Q->>M: P(known) for lesson concept
  M-->>Q: target difficulty (1-5)
  Q->>G: generate quiz (Zod schema)
  G-->>Q: draft items
  Q->>J: verify keys, grounding, run reference code
  J-->>Q: accept / reject per item (report stored)
  L->>Q: submit answers
  Q->>M: update BKT + Elo, item ratings
  Q-->>L: score, feedback, mastery delta, next difficulty
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn-style Radix components, Framer Motion, TipTap (Markdown), react-markdown + KaTeX + Mermaid, next-themes, sonner |
| API | Node 24, Fastify 5, tRPC v11 (+ superjson), Zod 4, Prisma 6, Socket.IO 4, pino, @fastify/rate-limit / helmet / cors / multipart / swagger |
| Data | PostgreSQL 16 + pgvector (HNSW cosine index), Redis 7 |
| AI | Anthropic SDK (`claude-opus-5-5`, structured outputs + streaming), Vercel AI SDK (OpenAI, Gemini, Ollama; `useChat` text transport), offline deterministic fake LLM, hashing / OpenAI embeddings |
| Learning science | FSRS-4.5, SM-2, Bayesian Knowledge Tracing, Elo |
| Sandbox | quickjs-emscripten (WASM, per-run isolation), Piston (optional compose profile) |
| Payments | Stripe Checkout + signed webhooks, mock billing mode |
| Testing | Vitest (unit + integration against real Postgres), Testing Library (jsdom), Playwright, v8 coverage |
| DevOps | Docker (non-root, health checks), Docker Compose, GitHub Actions |

## Screenshots

> _Placeholders — add screenshots after running the stack locally._
>
> | Dashboard | Lesson + Socratic tutor | Adaptive quiz result | FSRS review | Quiz battle | Instructor analytics |
> |---|---|---|---|---|---|
> | `docs/screenshots/dashboard.png` | `docs/screenshots/lesson.png` | `docs/screenshots/quiz.png` | `docs/screenshots/review.png` | `docs/screenshots/battle.png` | `docs/screenshots/instructor.png` |

## Local setup

Requirements: Docker Desktop, Node 24 (for local dev/tests). Host ports used: **21000** (web),
**21001** (API), **21010** (Postgres), **21011** (Redis), **21020** (Piston, optional).

### Everything in Docker (recommended)

```bash
cp .env.example .env            # optional – defaults work offline
docker compose up -d --build    # migrations + demo seed run automatically
open http://localhost:21000     # click "Learner (Alex)" or "Instructor (Dr. Maya)"
./scripts/smoke.sh              # scripted end-to-end sample of every feature
docker compose down             # add -v to wipe the database volume
```

Demo accounts (password `Password123!`): `alex@learnforge.dev` (learner), `maya@learnforge.dev`
(instructor), `admin@learnforge.dev` (admin), plus 7 more seeded learners with activity.

Optional real code execution for Python: `docker compose --profile sandbox up -d` and set
`SANDBOX_PROVIDER=piston` (install runtimes with Piston's CLI/API first).

### Local development

```bash
npm install
docker compose up -d postgres redis
cp .env.example backend/.env
npm run db:migrate -w backend && npm run seed
npm run dev                     # API on :21001 (tsx watch), web on :21000
```

### Quality gates

```bash
npm run lint && npm run typecheck
npm run test:coverage           # backend (needs Postgres on :21010) + frontend
npm run build
npm run e2e                     # Playwright against a running stack
```

## Environment variables

All variables are documented in [`.env.example`](.env.example); the most important ones:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://learnforge:learnforge@localhost:21010/learnforge` | PostgreSQL with pgvector |
| `REDIS_URL` | `redis://localhost:21011` | Rate-limit store (optional; empty disables) |
| `APP_URL` | `http://localhost:21000` | Public web URL (CORS allow-list, magic links, redirects) |
| `JWT_SECRET` | dev-only value | **Required in production** (≥ 24 chars) |
| `DEV_LOGIN_ENABLED` | `true` | Demo one-click logins + dev mailbox; set `false` in production |
| `LLM_PROVIDER` | `fake` | `fake` · `anthropic` · `openai` · `gemini` · `ollama` |
| `LLM_MODEL` / `JUDGE_MODEL` | provider default | e.g. `claude-opus-5-5` (Anthropic default) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | — | Provider credentials |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Local Ollama (OpenAI-compatible) |
| `EMBEDDING_PROVIDER` | `hash` | `hash` (offline) or `openai` |
| `SRS_ALGORITHM` | `fsrs` | `fsrs` or `sm2` |
| `SANDBOX_PROVIDER` / `PISTON_URL` | `quickjs` | `quickjs` or `piston` |
| `BILLING_MODE` | `mock` | `mock` or `stripe` (then `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO` are required) |
| `FREE_GENERATIONS_PER_MONTH` / `PRO_GENERATIONS_PER_MONTH` | `10` / `500` | AI generation quotas |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | — | Enable OAuth buttons |
| `API_INTERNAL_URL` / `NEXT_PUBLIC_WS_URL` | `http://localhost:21001` | Frontend build-time API proxy target and Socket.IO URL |

## API documentation

- Swagger UI: **http://localhost:21001/api/docs** (OpenAPI 3.1 JSON at `/api/docs/json`), generated from
  the tRPC routers' Zod schemas plus the REST endpoints. Export with `npm run openapi -w backend`.
- tRPC endpoint: `/api/trpc/<router>.<procedure>` (superjson); the typed client lives in `frontend/src/lib/trpc.ts`.
- Health: `GET /health` (DB + Redis).

## Deployment guide (Vercel + Neon + Upstash)

1. **Database — Neon:** create a Postgres project, enable the `vector` extension
   (`CREATE EXTENSION vector;`), copy the pooled connection string into `DATABASE_URL`, and run
   `npx prisma migrate deploy --schema backend/prisma/schema.prisma` (the API container also does this on start).
2. **Redis — Upstash:** create a Redis database and set `REDIS_URL=rediss://default:<token>@<host>:6379`.
3. **API:** deploy `backend/Dockerfile` (build context = repo root) to a container host that supports
   WebSockets (Fly.io, Render, Railway, ECS, Cloud Run with session affinity). Set `NODE_ENV=production`,
   a strong `JWT_SECRET`, `APP_URL=https://<your-vercel-domain>`, `COOKIE_SECURE=true`,
   `DEV_LOGIN_ENABLED=false`, `SEED_ON_START=false`, the LLM provider keys and (optionally) Stripe keys.
   Point a Stripe webhook at `https://<api>/api/billing/webhook` for `checkout.session.completed`,
   `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`.
4. **Web — Vercel:** import the repo, set the root directory to `frontend`, and set
   `API_INTERNAL_URL=https://<api-host>` (used by the `/api/*` rewrite) and
   `NEXT_PUBLIC_WS_URL=https://<api-host>`. Because the API is proxied through the Vercel domain, auth
   cookies stay first-party.
5. Single instance note: battle state is in-memory per API instance — run one API replica, or add the
   Socket.IO Redis adapter + sticky sessions before scaling out (see `docs/DECISIONS.md`).

## What I learned / Key engineering decisions

- **Make the LLM a replaceable, validated dependency.** Every AI task goes through one facade that
  builds prompts, validates output with Zod, repairs/retries once and fails with a clean 422. The
  deterministic fake provider made the whole product — seed data, 167 unit/integration/component tests, CI, e2e — runnable without
  keys, and it deliberately injects wrong answer keys so the quality gate is exercised, not assumed.
- **Trust, but verify generated content.** A quiz only ships after an LLM-as-judge review, deterministic
  grounding checks and executing each code question's reference solution in the sandbox.
- **Learning science as pure, tested functions.** FSRS-4.5, SM-2, BKT and Elo are side-effect-free modules
  with boundary tests (lapses, max intervals, clock skew, UTC day boundaries, extreme streaks); services
  only persist their state.
- **Security boundaries in the API, not the UI.** Rotating refresh tokens with reuse detection, RBAC +
  ownership checks (an integration test caught and fixed an IDOR in the flashcard queue), Redis rate
  limits, prompt-injection fencing, signed + idempotent webhooks, and user code that never touches the host
  (fresh WASM module per run with memory/time/output caps).
- **One state machine for two billing modes.** Mock checkout and Stripe webhooks emit the same signals
  into a pure transition function, so the mock mode tests the real logic.
- **End-to-end types without shared runtime code.** The frontend imports only the tRPC router *type*;
  superjson keeps dates honest across the wire.

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for trade-offs and scope notes.
