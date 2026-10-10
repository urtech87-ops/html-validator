import ExcelJS from "exceljs";
import { downloadBytes, downloadReport, expect, expectLayoutOk, SITE, test, uid } from "./fixtures";

test.describe("bulk mode", () => {
  test("URL list: live progress, site summary and an aggregated Excel report", async ({ page }, info) => {
    const token = uid();
    const urls = Array.from({ length: 6 }, (_, i) => `${SITE}/page/${i + 1}?t=${token}`);
    await page.goto("/bulk");
    await expect(page.getByRole("heading", { level: 1, name: "Validate a whole site" })).toBeVisible();
    await page.getByRole("tab", { name: "URL list" }).click();
    await page.getByLabel("URLs (one per line)").fill(`# comment line\n${urls.join("\n")}\n${urls[0]}\nnot a url at all`);
    await page.getByRole("button", { name: "Validate 6 pages" }).click();

    await expect(page.getByRole("progressbar", { name: "Bulk validation progress" })).toBeVisible();
    await expect(page.getByText("Finished: 6 pages")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("progressbar", { name: "Bulk validation progress" })).toHaveAttribute("aria-valuetext", "100%");
    await expect(page.getByRole("heading", { name: "Site summary" })).toBeVisible();
    await expect(page.getByText("6 with errors")).toBeVisible();
    await expect(page.getByTestId("saved-notice")).toContainText("Saved to history.");
    await expectLayoutOk(page, info);

    const download = await downloadReport(page, "Excel (.xlsx)");
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await downloadBytes(download)) as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Report Info", "Summary", "Issues", "Structure", "Issue Types"]);
    expect(workbook.getWorksheet("Summary")!.actualRowCount).toBe(7); // header + 6 pages
    // Each page has one missing alt: at least 6 issue rows.
    expect(workbook.getWorksheet("Issues")!.actualRowCount).toBeGreaterThanOrEqual(7);
  });

  test("sitemap: discovers pages from a site root and runs the selection", async ({ page }, info) => {
    await page.goto("/bulk");
    await page.getByLabel("Site or sitemap URL").fill(`${SITE}/`);
    await page.getByRole("button", { name: "Find pages" }).click();
    const found = page.getByRole("list", { name: "Pages found in the sitemap" });
    await expect(found.getByRole("listitem")).toHaveCount(6);
    // Untick one page, run the other five.
    await found.getByRole("checkbox").first().click();
    await page.getByRole("button", { name: "Validate 5 pages" }).click();
    await expect(page.getByText("Finished: 5 pages")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Site summary" })).toBeVisible();
    await expectLayoutOk(page, info);
  });

  test("cancel stops the queue and in-flight requests; the run is saved as cancelled", async ({ page }, info) => {
    const token = uid();
    const urls = Array.from({ length: 6 }, (_, i) => `${SITE}/slow/${i + 1}?t=${token}`);
    await page.goto("/bulk");
    await page.getByRole("tab", { name: "URL list" }).click();
    await page.getByLabel("URLs (one per line)").fill(urls.join("\n"));
    await page.getByRole("button", { name: "Validate 6 pages" }).click();
    await expect(page.getByText(/Validating… 0 of 6 pages done/)).toBeVisible();
    // The run has been created on the server (its id arrived in the "start" event).
    await expect(page.getByTestId("saved-notice")).toContainText("Saving to history as pages finish.");

    const cancelledAt = Date.now();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText(/Cancelled after 0 of 6 pages/)).toBeVisible();
    // Each slow page takes 4 s: cancelling must not wait for them.
    expect(Date.now() - cancelledAt).toBeLessThan(3_500);
    await expect(page.getByTestId("saved-notice")).toContainText("Saved to history.");

    // The server notices the disconnect, aborts the in-flight fetches and records the run as cancelled.
    await page.getByRole("link", { name: "Open saved run" }).click();
    await expect(page).toHaveURL(/\/history\/[\w-]+$/);
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expectLayoutOk(page, info);
  });
});
