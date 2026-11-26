import { execSync } from "node:child_process";
import { applyTestEnv, TEST_DATABASE_URL } from "./env";

export default function setup(): void {
  applyTestEnv();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } });
}
