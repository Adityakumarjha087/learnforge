import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", seed: "prisma/seed.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  splitting: true,
  // Keep runtime deps external; they are installed in the image.
  skipNodeModulesBundle: true,
});
