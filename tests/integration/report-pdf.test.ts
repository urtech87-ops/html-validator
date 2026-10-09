import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateReport } from "@/lib/report/generate";
import { ARABIC_HEADING, ARABIC_MENU, ARABIC_PROJECT, bulkPages, singleRequest } from "../helpers/report-fixtures";
import { containsArabic, hasReplacementChars, pdfFontNames, pdfText } from "../helpers/pdf-text";

/**
 * Renders real PDFs with the local Playwright Chromium shell
 * (PLAYWRIGHT_BROWSERS_PATH, see README). The Docker image is covered by
 * tests/docker/report-pdf.docker.test.ts.
 */

const OUT = path.resolve(import.meta.dirname, "../../test-results");

describe("PDF report (local Chromium)", () => {
  it("renders Arabic extracts and messages as real, extractable Arabic text", async () => {
    const report = await generateReport(singleRequest("pdf"));
    const bytes = report.body as Uint8Array;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "local-arabic-report.pdf"), bytes);

    expect(report.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { pages, text } = await pdfText(bytes);
    expect(pages).toBeGreaterThanOrEqual(3); // cover, summary, details (+ appendix)
    expect(text).toContain("Validation report");
    expect(text).toContain("Executive summary");
    expect(text).toMatch(/Page\s+1\s+of\s+\d+/);
    for (const word of [ARABIC_HEADING, ARABIC_MENU, ARABIC_PROJECT]) expect(containsArabic(text, word), word).toBe(true);
    expect(hasReplacementChars(text)).toBe(false);
    // An Arabic-capable font was embedded (Noto in Docker; Segoe UI/Tahoma/Arial on Windows).
    expect(pdfFontNames(bytes).some((f) => /Arabic|Segoe|Tahoma|Arial|Noto/i.test(f))).toBe(true);
  });

  it("renders a bulk report with a site-wide section", async () => {
    const report = await generateReport({
      ...singleRequest("pdf"),
      source: { kind: "bulk", target: "https://example.com/sitemap.xml", mode: "sitemap", pages: bulkPages(), startedAt: "2026-10-09T09:00:00.000Z", cancelled: false },
    });
    const { text } = await pdfText(report.body as Uint8Array);
    expect(text).toContain("Site validation report");
    expect(text).toContain("Most common issues site-wide");
    expect(text).toContain("https://example.com/p4");
  });
});
