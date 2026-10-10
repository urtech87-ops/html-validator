import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test as base, expect, type Download, type Page, type TestInfo } from "@playwright/test";

/** The fixture website (tests/e2e/site/server.mjs). */
export const SITE = "http://127.0.0.1:3199";

/** A token that makes this test's targets unique in the shared e2e history. */
export const uid = () => randomUUID().slice(0, 8);

/** A documentation-range address (198.18.0.0/15) unique to one test, used as its x-forwarded-for. */
function clientIpFor(info: TestInfo): string {
  let h = 0;
  for (const c of `${info.project.name}|${info.titlePath.join("|")}|${info.retry}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `198.${18 + (h & 1)}.${(h >>> 1) & 255}.${(h >>> 9) & 255}`;
}

// Fixture callbacks name their "use" argument "provide": the React hooks lint rule would flag "use".
export const test = base.extend<{ clientIp: string; guard: void }>({
  clientIp: async ({}, provide, info) => provide(clientIpFor(info)),

  // Each test is its own client for the per-IP rate limits (the global cap is off in e2e).
  context: async ({ context, clientIp }, provide) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": clientIp });
    await provide(context);
  },

  /** Fails the test on any alert/confirm dialog or uncaught page error (e.g. injected script). */
  guard: [
    async ({ page }, provide) => {
      const problems: string[] = [];
      page.on("dialog", async (d) => {
        problems.push(`dialog: ${d.type()} ${d.message()}`);
        await d.dismiss();
      });
      page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
      await provide();
      expect(problems, "no dialogs or page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const isPhone = (info: TestInfo) => info.project.name.startsWith("phone");
export const isDark = (info: TestInfo) => info.project.name.endsWith("dark");

/** The page follows the emulated colour scheme and fits the viewport without sideways scrolling. */
export async function expectLayoutOk(page: Page, info: TestInfo) {
  await expect(page.locator("html")).toHaveClass(isDark(info) ? /\bdark\b/ : /^(?!.*\bdark\b)/);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `no horizontal scroll at ${clientWidth}px`).toBeLessThanOrEqual(clientWidth + 1);
}

/** Type into the direct-input editor: a textarea below 640 px, Monaco above. */
export async function setEditorText(page: Page, text: string) {
  const textarea = page.locator("textarea#direct-input-editor");
  if (await textarea.isVisible()) {
    await textarea.fill(text);
    return;
  }
  await page.waitForFunction(() => (window as unknown as { monaco?: { editor: { getModels(): unknown[] } } }).monaco?.editor.getModels().length);
  await page.evaluate((value) => {
    const monaco = (window as unknown as { monaco: { editor: { getModels(): { setValue(v: string): void }[] } } }).monaco;
    monaco.editor.getModels()[0].setValue(value);
  }, text);
}

export async function validateUrl(page: Page, url: string) {
  await page.goto("/");
  await page.getByLabel("Page address").fill(url);
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByTestId("saved-notice")).toBeVisible({ timeout: 60_000 });
}

/** Message cards currently listed (each has data-line). */
export const messageCards = (page: Page) => page.getByRole("list", { name: "Messages" }).locator("[data-line]");

/** Open the report dialog, choose a format and download. */
export async function downloadReport(page: Page, format: "PDF" | "Excel (.xlsx)" | "HTML (single file)" | "JSON" | "CSV (issues)"): Promise<Download> {
  const dialog = page.getByRole("dialog", { name: "Generate report" });
  if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Generate report" }).first().click();
  await dialog.getByText(format, { exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), dialog.getByRole("button", { name: /^Download / }).click()]);
  await expect(dialog.getByText(/Downloaded/)).toBeVisible();
  return download;
}

export async function downloadBytes(download: Download): Promise<Buffer> {
  return readFile((await download.path())!);
}
