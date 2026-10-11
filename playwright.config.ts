import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a production build (`npm run test:e2e`).
 * Needs vnu (`docker compose up -d vnu`) and the Chromium headless shell
 * (PLAYWRIGHT_BROWSERS_PATH=D:\ms-playwright on this machine; see README).
 * All output stays in test-results/ on the project drive.
 *
 * Four projects: desktop (1280 px) and phone (375 px), each in light and dark.
 */

const APP = "http://127.0.0.1:3100";
const SITE = "http://127.0.0.1:3199";

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } };
// A 375 px phone viewport in Chromium (devices["iPhone …"] would need WebKit).
const phone = { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e/artifacts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "test-results/e2e/report", open: "never" }]],
  use: {
    baseURL: APP,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "desktop-light", use: { ...desktop, colorScheme: "light" } },
    { name: "desktop-dark", use: { ...desktop, colorScheme: "dark" } },
    { name: "phone-light", use: { ...phone, colorScheme: "light" } },
    { name: "phone-dark", use: { ...phone, colorScheme: "dark" } },
  ],
  webServer: [
    {
      command: "node tests/e2e/site/server.mjs",
      url: `${SITE}/health`,
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: "node scripts/e2e-server.mjs",
      url: `${APP}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
