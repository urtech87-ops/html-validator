import path from "node:path";
import { defineConfig } from "vitest/config";

/** Docker tests: run against the full stack (docker compose up -d --build). */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": path.resolve(import.meta.dirname, "tests/unit/stubs/server-only.ts") },
  },
  test: {
    include: ["tests/docker/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
