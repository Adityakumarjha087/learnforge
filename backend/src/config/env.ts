import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(21001),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default(""),
  APP_URL: z.string().url().default("http://localhost:21000"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:21001"),
  CORS_ORIGINS: z.string().default(""),

  JWT_SECRET: z.string().min(16).default("dev-only-insecure-secret-change-me"),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default(false),
  DEV_LOGIN_ENABLED: bool.default(true),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),

  LLM_PROVIDER: z.enum(["fake", "openai", "anthropic", "gemini", "ollama"]).default("fake"),
  LLM_MODEL: z.string().default(""),
  JUDGE_MODEL: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().default(""),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434/v1"),
  EMBEDDING_PROVIDER: z.enum(["hash", "openai"]).default("hash"),

  SANDBOX_PROVIDER: z.enum(["quickjs", "piston"]).default("quickjs"),
  PISTON_URL: z.string().default("http://localhost:21020"),
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),

  BILLING_MODE: z.enum(["mock", "stripe"]).default("mock"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_PRO: z.string().default(""),

  FREE_GENERATIONS_PER_MONTH: z.coerce.number().int().nonnegative().default(10),
  PRO_GENERATIONS_PER_MONTH: z.coerce.number().int().nonnegative().default(500),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(10),
  SEED_ON_START: bool.default(false),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.JWT_SECRET.startsWith("dev-only")) {
    throw new Error("JWT_SECRET must be set in production");
  }
  return env;
}

let cached: Env | undefined;
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test helper: override parts of the environment. */
export function setEnvForTests(overrides: Partial<Env>): void {
  cached = { ...env(), ...overrides };
}
