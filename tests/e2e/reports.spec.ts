import ExcelJS from "exceljs";
import { downloadBytes, downloadReport, expect, expectLayoutOk, SITE, test, uid, validateUrl } from "./fixtures";

test.describe("reports", () => {
  test("all five formats download from a single run and are saved with it", async ({ page }, info) => {
    await validateUrl(page, `${SITE}/bad.html?t=${uid()}`);

    const pdf = await downloadBytes(await downloadReport(page, "PDF"));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const xlsx = await downloadBytes(await downloadReport(page, "Excel (.xlsx)"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx as unknown as ArrayBuffer);
    const issues = workbook.getWorksheet("Issues")!;
    expect(issues.actualRowCount).toBeGreaterThan(3);
    // Status dropdown (Open / Fixed / Won't fix) on the first issue row.
    const header = (issues.getRow(1).values as unknown[]).map(String);
    const statusCol = header.indexOf("Status");
    expect(statusCol).toBeGreaterThan(0);
    expect(issues.getCell(2, statusCol).dataValidation?.formulae?.[0]).toMatch(/Open,Fixed,Won't fix/);

    const html = (await downloadBytes(await downloadReport(page, "HTML (single file)"))).toString("utf8");
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain("Content-Security-Policy");

    const json = JSON.parse((await downloadBytes(await downloadReport(page, "JSON"))).toString("utf8"));
    expect(json).toMatchObject({ schema: "markuplens-report", version: 1 });

    const csv = await downloadBytes(await downloadReport(page, "CSV (issues)"));
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM

    // Saved with the run: listed on the saved run page and downloadable again.
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Open saved run" }).click();
    await expect(page.getByRole("heading", { name: "Saved reports" })).toBeVisible();
    const again = page.getByRole("link", { name: /^Download markuplens-.*\.pdf$/ });
    await expect(again).toBeVisible();
    const [redownload] = await Promise.all([page.waitForEvent("download"), again.click()]);
    expect((await downloadBytes(redownload)).equals(pdf)).toBe(true);
    await expectLayoutOk(page, info);
  });
});

test.describe("user content is only ever shown as text", () => {
  test("a page full of script injections runs nothing in the results, tabs or HTML report", async ({ page }, info) => {
    await page.addInitScript(() => {
      (window as unknown as { __xss?: unknown }).__xss = undefined;
    });
    await validateUrl(page, `${SITE}/xss.html?t=${uid()}`);
    for (const tab of [/^Messages/, /^Structure/, /^Outline/, /^Images/, /^Source/]) {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(300);
    }
    const injected = await page.evaluate(() => ({
      xss: (window as unknown as { __xss?: unknown }).__xss,
      elements: document.querySelectorAll('main img[src="x"], main svg[onload], main foo, main iframe, main [onerror], main [onclick]').length,
      links: [...document.querySelectorAll("main a[href]")].filter((a) => a.getAttribute("href")!.startsWith("javascript:")).length,
    }));
    expect(injected).toEqual({ xss: undefined, elements: 0, links: 0 });
    // The markup is visible as text instead.
    await page.getByRole("tab", { name: /^Images/ }).click();
    await expect(page.getByText(/onerror=window\.__xss=5/).first()).toBeVisible();

    const html = (await downloadBytes(await downloadReport(page, "HTML (single file)"))).toString("utf8");
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/<img[^>]+onerror/i);
    expect(html).toContain("&lt;script&gt;");
    await expectLayoutOk(page, info);
  });

  test("security headers on pages and sandboxed HTML report downloads", async ({ page, request }) => {
    const home = await request.get("/");
    expect(home.headers()).toMatchObject({
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    expect(home.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");

    const run = await (await request.post("/api/validate", { data: { type: "html", value: `<!DOCTYPE html><title>${uid()}</title><p>x` } })).json();
    const report = await request.post("/api/report", { data: { runId: run.runId, format: "html" } });
    expect(report.status()).toBe(200);
    expect(report.headers()["content-security-policy"]).toMatch(/^sandbox; default-src 'none'/);
    expect(report.headers()["content-disposition"]).toMatch(/^attachment;/);
    const saved = await request.get(`/api/history/reports/${report.headers()["x-report-id"]}`);
    expect(saved.headers()["content-security-policy"]).toMatch(/^sandbox;/);
    await page.goto("/");
  });
});

test.describe("rate limits", () => {
  test("31st validation within a minute gets 429 with Retry-After; the UI says why; health stays open", async ({ page }) => {
    // page.request carries this test's own x-forwarded-for (see fixtures.ts), so it has a fresh budget.
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await page.request.post("/api/validate", { data: { type: "css", value: `a { color: red } /* ${i} */`, save: false } });
      statuses.push(res.status());
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
    const limited = await page.request.post("/api/validate", { data: { type: "css", value: "a{}", save: false } });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect((await limited.json()).error).toMatch(/at most 30 per minute/);
    expect((await page.request.get("/api/health")).status()).toBe(200);
    // History reads have their own budget.
    expect((await page.request.get("/api/history")).status()).toBe(200);

    await page.goto("/");
    await page.getByLabel("Page address").fill(`${SITE}/bad.html`);
    await page.getByRole("button", { name: "Validate", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Validation failed" })).toContainText(/Too many validation and report requests/);
  });
});
