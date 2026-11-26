import { BattleManager } from "./battle/manager";
import { env } from "./config/env";
import { buildApp, corsOrigins } from "./http/app";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { closeRedis } from "./lib/redis";

async function main() {
  const app = await buildApp();
  await app.ready();
  const battles = new BattleManager(app.server, prisma, corsOrigins());
  await app.listen({ port: env().PORT, host: env().HOST });
  logger.info({ port: env().PORT, llm: env().LLM_PROVIDER, billing: env().BILLING_MODE, sandbox: env().SANDBOX_PROVIDER }, "LearnForge API ready");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await battles.close().catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
