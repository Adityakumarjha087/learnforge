import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/scripts/**", "src/ai/providers/anthropic.ts", "src/ai/providers/aisdk.ts"],
      reporter: ["text-summary", "text", "json-summary", "lcov"],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
    },
  },
});
