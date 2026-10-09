import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ARABIC_HEADING, ARABIC_MENU, ARABIC_PROJECT, singleRequest } from "../helpers/report-fixtures";
import { containsArabic, hasReplacementChars, pdfFontNames, pdfText } from "../helpers/pdf-text";

/**
 * PDF rendering inside the Docker image: POSTs a report with Arabic extracts
 * to the running app container and checks the PDF it returns.
 *
 *   docker compose up -d --build
 *   npm run test:docker            # MARKUPLENS_URL defaults to http://127.0.0.1:3000
 *
 * 127.0.0.1 (not localhost) so the container answers, not a dev server on ::1.
 */

const BASE = process.env.MARKUPLENS_URL ?? "http://127.0.0.1:3000";
const OUT = path.resolve(import.meta.dirname, "../../test-results");

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/health`).catch((err: unknown) => {
    throw new Error(`The Docker app isn't reachable at ${BASE} (${String(err)}). Start it with \`docker compose up -d --build\`.`);
  });
  expect(res.ok, `GET ${BASE}/api/health returned ${res.status}`).toBe(true);
});

describe("PDF report rendered by the Docker image", () => {
  it("embeds Noto Arabic fonts and keeps Arabic text extractable (no tofu)", async () => {
    const res = await fetch(`${BASE}/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(singleRequest("pdf")),
    });
    expect(res.status, await res.clone().text().catch(() => "")).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename=".+\.pdf"/);

    const bytes = new Uint8Array(await res.arrayBuffer());
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "docker-arabic-report.pdf"), bytes);

    const fonts = pdfFontNames(bytes);
    // Arabic glyphs come from the Noto Arabic fonts installed in the image, not a last-resort font.
    expect(fonts.some((f) => /Noto(Sans|Naskh)Arabic/i.test(f)), `fonts: ${fonts.join(", ")}`).toBe(true);

    const { text } = await pdfText(bytes);
    for (const word of [ARABIC_HEADING, ARABIC_MENU, ARABIC_PROJECT]) expect(containsArabic(text, word), word).toBe(true);
    expect(hasReplacementChars(text)).toBe(false);
    expect(text).toContain("Validation report");
  });

  it("returns an Excel workbook from the container", async () => {
    const res = await fetch(`${BASE}/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(singleRequest("xlsx")),
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK"); // zip container
  });
});
