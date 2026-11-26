import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env().NODE_ENV === "test" ? "silent" : env().LOG_LEVEL,
  base: { service: "learnforge-api" },
  redact: { paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"], censor: "[redacted]" },
  transport:
    env().NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true, singleLine: true } } : undefined,
});

export type Logger = typeof logger;
