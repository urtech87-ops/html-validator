import path from "node:path";
import { defineConfig } from "vitest/config";

/** Integration tests: run against the real, pinned vnu (docker compose up -d vnu). */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": path.resolve(import.meta.dirname, "tests/unit/stubs/server-only.ts") },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Rate limits have unit tests; these tests call the routes in quick succession.
    env: { RATE_LIMIT_ENABLED: "false" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
