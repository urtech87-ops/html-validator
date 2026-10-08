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
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
