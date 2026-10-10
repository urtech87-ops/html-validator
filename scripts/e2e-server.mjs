#!/usr/bin/env node
/**
 * Production server for the e2e tests: `next start` on 127.0.0.1:3100 with a
 * throwaway history in test-results/e2e/data (recreated on every run, so the
 * tests never touch ./data or the Docker volume). Needs `npm run build` first
 * (`npm run test:e2e` does both) and vnu on VNU_URL (docker compose up -d vnu).
 *
 * Rate limits keep their defaults per client (each test sends its own
 * x-forwarded-for), but the global cap and the concurrent-bulk-run limit are
 * off: the test workers run in parallel and would otherwise share them.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, "test-results", "e2e", "data");
const port = process.env.E2E_APP_PORT || "3100";

if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("No production build found. Run `npm run build` first (or `npm run test:e2e`, which builds).");
  process.exit(1);
}

// Only ever this throwaway folder inside test-results/.
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: "production",
  DATA_DIR: dataDir,
  VNU_URL: process.env.VNU_URL || "http://localhost:8888",
  ALLOW_PRIVATE_URLS: "true",
  RUNNING_IN_DOCKER: "false",
  RATE_LIMIT_ENABLED: "true",
  RATE_LIMIT_GLOBAL_PER_MIN: "0",
  RATE_LIMIT_BULK_CONCURRENT: "0",
  NEXT_TELEMETRY_DISABLED: "1",
};

const bin = (name) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

const migrate = spawnSync(bin("prisma"), ["migrate", "deploy"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
if (migrate.status !== 0) {
  console.error("prisma migrate deploy failed for the e2e database.");
  process.exit(1);
}

const server = spawn(bin("next"), ["start", "-H", "127.0.0.1", "-p", port], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
