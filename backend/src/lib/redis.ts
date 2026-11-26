import { Redis } from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

let client: Redis | null | undefined;

/** Returns a shared Redis client, or null when REDIS_URL is not configured (features degrade gracefully). */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = env().REDIS_URL;
  if (!url) {
    client = null;
    return client;
  }
  client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false, enableOfflineQueue: true });
  client.on("error", (err) => logger.warn({ err: err.message }, "redis error"));
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) await client.quit().catch(() => undefined);
  client = undefined;
}
