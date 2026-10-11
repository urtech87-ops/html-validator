import ExcelJS from "exceljs";
import { downloadBytes, expect, expectLayoutOk, SITE, test, uid, validateUrl } from "./fixtures";

test.describe("history, re-run and compare", () => {
  test("fix verification: two runs of a changed page compare as new / fixed, with a comparison Excel", async ({ page, request }, info) => {
    const key = `k${uid()}`;
    const url = `${SITE}/mutable/${key}`;
    await request.get(`${SITE}/__mutable/${key}/a`);
    await validateUrl(page, url);
    await request.get(`${SITE}/__mutable/${key}/b`);
    await validateUrl(page, url);

    // Search history for this page: two runs.
    await page.goto(`/history`);
    await page.getByLabel("Search").fill(key);
    await page.getByLabel("Search").press("Enter");
    await expect(page.getByText("2 runs match")).toBeVisible();
    await expectLayoutOk(page, info);
    const rows = page.getByRole("table").getByRole("checkbox", { name: `Select ${url}` });
    await expect(rows).toHaveCount(2);
    await rows.nth(0).click();
    await rows.nth(1).click();
    await page.getByRole("button", { name: "Compare selected" }).click();

    await expect(page).toHaveURL(/\/history\/compare\?a=.+&b=.+/);
    const fixedTab = page.getByRole("tab", { name: /^Fixed \(\d+\)/ });
    const newTab = page.getByRole("tab", { name: /^New \(\d+\)/ });
    const count = async (tab: typeof fixedTab) => Number(/\((\d+)\)/.exec((await tab.textContent()) ?? "")![1]);
    expect(await count(fixedTab)).toBeGreaterThanOrEqual(2); // missing alt + <center>
    expect(await count(newTab)).toBeGreaterThanOrEqual(1); // <font>
    await newTab.click();
    await expect(page.getByText(/font/).first()).toBeVisible();
    await expectLayoutOk(page, info);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download comparison (Excel)" }).click()]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await downloadBytes(download)) as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Comparison Info", "Pages", "Issues"]);
    const issues = workbook.getWorksheet("Issues")!;
    const header = (issues.getRow(1).values as unknown[]).map(String);
    const changeCol = header.indexOf("Change");
    const changes = new Set<string>();
    issues.eachRow((row, n) => n > 1 && changes.add(String(row.getCell(changeCol).value)));
    expect([...changes]).toEqual(expect.arrayContaining(["New", "Fixed", "Unchanged"]));
  });

  test("saved run: re-run with the original options, compare with previous run, delete", async ({ page }, info) => {
    const url = `${SITE}/bad.html?t=${uid()}`;
    await validateUrl(page, url);
    await page.getByRole("link", { name: "Open saved run" }).click();
    const first = page.url();
    await expectLayoutOk(page, info);

    await page.getByRole("button", { name: `Re-run ${url}` }).click();
    await expect(page).not.toHaveURL(first);
    await expect(page).toHaveURL(/\/history\/[\w-]+$/);
    await page.getByRole("link", { name: "Compare with previous run" }).click();
    await expect(page.getByRole("tab", { name: /^Unchanged \(\d+\)/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "New (0)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Fixed (0)" })).toBeVisible();

    // Delete one of the two runs from the history list.
    await page.goto(`/history?q=${encodeURIComponent(url)}`);
    const boxes = page.getByRole("table").getByRole("checkbox", { name: `Select ${url}` });
    await expect(boxes).toHaveCount(2);
    await boxes.first().click();
    await page.getByRole("button", { name: "Delete selected" }).click();
    await page.getByRole("dialog", { name: "Delete this run?" }).getByRole("button", { name: "Delete" }).click();
    await expect(boxes).toHaveCount(1);
    await expect(page.getByText("1 run match")).toBeVisible();
  });
});

test.describe("API docs and theme", () => {
  test("/api-docs documents the endpoints", async ({ page }, info) => {
    await page.goto("/api-docs");
    await expect(page.getByRole("heading", { level: 1, name: "API" })).toBeVisible();
    for (const endpoint of ["POST /api/validate", "POST /api/validate/upload", "POST /api/report", "GET /api/history/reports/:id"]) {
      await expect(page.getByText(endpoint).first()).toBeVisible();
    }
    await expect(page.getByText(/curl/).first()).toBeVisible();
    await expectLayoutOk(page, info);
  });

  test("theme toggle overrides the system scheme and is remembered", async ({ page }, info) => {
    await page.goto("/");
    const dark = info.project.name.endsWith("dark");
    await page.getByRole("button", { name: "Change colour theme" }).click();
    await page.getByRole("menuitemradio", { name: dark ? "Light" : "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(dark ? /^(?!.*\bdark\b)/ : /\bdark\b/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(dark ? /^(?!.*\bdark\b)/ : /\bdark\b/);
    await page.getByRole("button", { name: "Change colour theme" }).click();
    await page.getByRole("menuitemradio", { name: "System" }).click();
    await expectLayoutOk(page, info);
  });
});
