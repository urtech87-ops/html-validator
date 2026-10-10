import { expect, expectLayoutOk, isPhone, messageCards, setEditorText, SITE, test, uid, validateUrl } from "./fixtures";

test.describe("single-page validation", () => {
  test("by URL: messages, linked stylesheet, structure, outline, images and source", async ({ page }, info) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Check your HTML and CSS" })).toBeVisible();
    await expect(page.getByTestId("engine-status").first()).toContainText(/online/i);
    await expectLayoutOk(page, info);

    await validateUrl(page, `${SITE}/bad.html?t=${uid()}`);
    await expect(page.getByRole("heading", { level: 2, name: /bad\.html/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Message counts" }).first()).toContainText(/\d+\s*errors?/i);

    // HTML messages for the known problems.
    await expect(messageCards(page).filter({ hasText: "Duplicate ID" }).first()).toBeVisible();
    await expect(messageCards(page).filter({ hasText: /alt/ }).first()).toBeVisible();

    // The linked stylesheet is validated as its own CSS document.
    const documents = page.getByRole("navigation", { name: "Validated documents" });
    await expect(documents).toContainText("style.css");
    await documents.getByText("style.css").click();
    await expect(messageCards(page).filter({ hasText: /colr/ }).first()).toBeVisible();
    await documents.getByText(/bad\.html/).click();

    await page.getByRole("tab", { name: /^Structure/ }).click();
    await expect(page.getByRole("tabpanel", { name: /^Structure/ })).toContainText(/Unique IDs/i);
    await expect(page.getByRole("tabpanel", { name: /^Structure/ })).toContainText(/Deprecated elements/i);

    await page.getByRole("tab", { name: /^Outline/ }).click();
    await expect(page.getByRole("list", { name: "Heading outline" })).toContainText("Skipped heading level");

    await page.getByRole("tab", { name: /^Images/ }).click();
    await expect(page.getByText("photo.png").first()).toBeVisible();

    await page.getByRole("tab", { name: /^Source/ }).click();
    await expect(page.getByText(/obsolete/).first()).toBeVisible();
    await expectLayoutOk(page, info);
  });

  test("upload: several files at once, archives refused", async ({ page }, info) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Upload" }).click();
    const picker = page.getByLabel("Choose files to validate");
    const token = uid();
    await picker.setInputFiles([
      { name: `upload-${token}.html`, mimeType: "text/html", buffer: Buffer.from('<!DOCTYPE html><html lang="en"><title>t</title><p id=a><p id=a>') },
      { name: `upload-${token}.css`, mimeType: "text/css", buffer: Buffer.from("p { colr: red }") },
    ]);
    await expect(page.getByRole("list", { name: "Selected files" })).toContainText(`upload-${token}.css`);
    await page.getByRole("button", { name: /^Validate/ }).click();
    await expect(page.getByTestId("saved-notice")).toBeVisible({ timeout: 60_000 });
    const documents = page.getByRole("navigation", { name: "Validated documents" });
    await expect(documents).toContainText(`upload-${token}.html`);
    await expect(documents).toContainText(`upload-${token}.css`);
    await expect(messageCards(page).filter({ hasText: "Duplicate ID" }).first()).toBeVisible();

    // A zip archive renamed to .html is refused by the server.
    await page.getByRole("tab", { name: "Upload" }).click();
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    const response = await page.request.post("/api/validate/upload", {
      multipart: { files: { name: "archive.html", mimeType: "text/html", buffer: zip } },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/looks like a ZIP archive/);
    await expectLayoutOk(page, info);
  });

  test("direct input: fragment line numbers map back to the input; CSS mode", async ({ page }, info) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Direct input" }).click();
    await page.getByRole("radio", { name: "Fragment" }).click();
    // The duplicate id is on line 3 of what the user typed.
    await setEditorText(page, `<section>\n  <p id="x">one</p>\n  <p id="x">two</p>\n</section>`);
    await page.getByRole("button", { name: "Validate", exact: true }).click();
    await expect(page.getByTestId("saved-notice")).toBeVisible({ timeout: 60_000 });
    const duplicate = messageCards(page).filter({ hasText: "Duplicate ID" }).first();
    await expect(duplicate).toHaveAttribute("data-line", "3");

    await page.getByRole("radio", { name: "CSS" }).click();
    await setEditorText(page, `/* ${uid()} */\nbody {\n  colr: red;\n}`);
    await page.getByRole("button", { name: "Validate", exact: true }).click();
    await expect(messageCards(page).filter({ hasText: /colr/ }).first()).toHaveAttribute("data-line", "3", { timeout: 60_000 });
    if (isPhone(info)) await expect(page.locator("textarea#direct-input-editor")).toBeVisible();
    await expectLayoutOk(page, info);
  });
});
