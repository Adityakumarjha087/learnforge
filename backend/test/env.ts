// Shared test environment (imported by global setup and per-file setup).
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://learnforge:learnforge@localhost:21010/learnforge_test";
import { randomBytes } from "node:crypto";

// Generated per test run (inherited by workers via process.env) so no secret-shaped literal lives in git.
process.env.TEST_STRIPE_WEBHOOK_SECRET ??= `whsec_${randomBytes(24).toString("hex")}`;
export const TEST_WEBHOOK_SECRET = process.env.TEST_STRIPE_WEBHOOK_SECRET;

export function applyTestEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: "",
    LLM_PROVIDER: "fake",
    EMBEDDING_PROVIDER: "hash",
    BILLING_MODE: "mock",
    STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: "",
    DEV_LOGIN_ENABLED: "true",
    JWT_SECRET: "test-secret-for-learnforge-unit-tests",
    APP_URL: "http://localhost:21000",
    SANDBOX_PROVIDER: "quickjs",
    LOG_LEVEL: "silent",
  });
}
