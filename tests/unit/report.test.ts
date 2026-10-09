import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { csvCell, renderCsv } from "@/lib/report/csv";
import { ISSUE_STATUSES, renderExcel } from "@/lib/report/excel";
import { contentDisposition, reportFilename, slugify } from "@/lib/report/filename";
import { esc, renderHtml } from "@/lib/report/html";
import { renderJson } from "@/lib/report/json";
import { checkLogoBytes, checkLogoDataUrl, imageSize, sniffImageType } from "@/lib/report/logo";
import { buildReportModel, issueId, normalizeExtract } from "@/lib/report/model";
import { parseReportRequest, ReportRequestError } from "@/lib/report/request";
import { defaultContents, MAX_GROUPS_PER_DOCUMENT, type ReportRequest } from "@/lib/report/types";
import { ARABIC_HEADING, ARABIC_MENU, ARABIC_PROJECT, arabicRun, bulkPages, doc, msg, singleRequest } from "../helpers/report-fixtures";

const PNG_1x1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const pngDataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_1x1))}`;

function bulkRequest(format: ReportRequest["format"], cancelled = false): ReportRequest {
  return {
    ...singleRequest(format),
    source: { kind: "bulk", target: "https://example.com/sitemap.xml", mode: "sitemap", pages: bulkPages(), startedAt: "2026-10-09T09:00:00.000Z", cancelled },
  };
}

describe("defaultContents", () => {
  it("turns everything on and info only for verbose runs", () => {
    expect(defaultContents(false)).toEqual({ summary: true, errors: true, warnings: true, info: false, extracts: true, structure: true, outline: true, images: true });
    expect(defaultContents(true).info).toBe(true);
  });
});

describe("logo checks", () => {
  it("recognises PNG, JPEG and WebP by their bytes and rejects SVG", () => {
    expect(sniffImageType(PNG_1x1)).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeUndefined();
  });

  it("validates data: URLs by content, not by the declared type", () => {
    const svg = `data:image/png;base64,${btoa("<svg onload=alert(1)></svg>")}`;
    expect(checkLogoDataUrl(svg)).toEqual({ ok: false, error: "The logo must be a PNG, JPEG or WebP image." });
    expect(checkLogoDataUrl("https://example.com/logo.png").ok).toBe(false);
    const ok = checkLogoDataUrl(pngDataUrl);
    expect(ok.ok && ok.type).toBe("image/png");
  });

  it("rejects logos over 1 MB", () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PNG_1x1.subarray(0, 8));
    expect(checkLogoBytes(big)).toEqual({ ok: false, error: "The logo is larger than 1 MB." });
  });

  it("reads PNG dimensions", () => {
    expect(imageSize(PNG_1x1, "image/png")).toEqual({ width: 1, height: 1 });
  });
});

describe("parseReportRequest", () => {
  const body = () => JSON.parse(JSON.stringify(singleRequest("pdf")));

  it("accepts a valid request and fills defaults", () => {
    const b = body();
    delete b.branding.reportDate;
    delete b.contents;
    const r = parseReportRequest(b, new Date("2026-10-09T12:00:00Z"));
    expect(r.format).toBe("pdf");
    expect(r.branding.reportDate).toBe("2026-10-09");
    expect(r.contents).toEqual(defaultContents(false));
  });

  it("rejects unknown formats, malformed runs and bad logos", () => {
    expect(() => parseReportRequest({ ...body(), format: "docx" })).toThrow(ReportRequestError);
    expect(() => parseReportRequest({ ...body(), source: { kind: "single", run: { documents: "x" } } })).toThrow(/not a validation result/);
    expect(() => parseReportRequest({ ...body(), branding: { logo: "data:image/svg+xml;base64,PHN2Zz4=" } })).toThrow(/PNG, JPEG or WebP/);
    expect(() => parseReportRequest({ ...body(), source: { kind: "bulk", pages: Array.from({ length: 201 }, () => ({ url: "https://a.b/" })) } })).toThrow(/200 pages/);
  });

  it("trims branding and caps its length", () => {
    const r = parseReportRequest({ ...body(), branding: { project: `  ${"x".repeat(300)}  `, preparedBy: " QA ", reportDate: "not a date" } }, new Date("2026-01-02T00:00:00Z"));
    expect(r.branding.project).toHaveLength(120);
    expect(r.branding.preparedBy).toBe("QA");
    expect(r.branding.reportDate).toBe("2026-01-02");
  });
});

describe("issue IDs", () => {
  it("are stable across line moves, whitespace and URL fragments", () => {
    const a = issueId("https://Example.com/a#top", "Duplicate ID “x”.", '<div  id="x">\n</div>');
    const b = issueId("https://example.com/a", "Duplicate ID “x”.", '<div id="x"> </div>');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(issueId("https://example.com/a", "Duplicate ID “y”.", '<div id="x"> </div>')).not.toBe(a);
    expect(issueId("https://example.com/b", "Duplicate ID “x”.", '<div id="x"> </div>')).not.toBe(a);
    expect(normalizeExtract("  a\n\t b ")).toBe("a b");
  });

  it("number identical issues within one document", () => {
    const run = arabicRun();
    const page = run.documents[0];
    page.messages.push({ ...page.messages[0], id: "dup" });
    const model = buildReportModel({ ...singleRequest("json"), source: { kind: "single", run } });
    const ids = model.documents[0].issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith(ids[0].slice(0, 10)))).toEqual([ids[0], `${ids[0]}-2`]);
  });
});

describe("buildReportModel", () => {
  it("summarises a single run", () => {
    const m = buildReportModel(singleRequest("pdf"));
    expect(m.kind).toBe("single");
    expect(m.target).toBe("https://example.com/ar/");
    expect(m.inputType).toBe("URL");
    expect(m.counts).toEqual({ errors: 4, warnings: 1, info: 1 });
    expect(m.averageScore).toBe(79);
    expect(m.documents.map((d) => d.origin)).toEqual(["url", "stylesheet"]);
    expect(m.documents[1].pageUrl).toBe("https://example.com/ar/");
    expect(m.issueCount).toBe(6);
    expect(m.issueTypes[0]).toMatchObject({ message: `Duplicate ID “${ARABIC_MENU}”.`, occurrences: 2, pages: 1 });
    expect(m.documents[0].issues.find((i) => i.message.startsWith("Element “center”"))?.fix).toBeTruthy();
  });

  it("filters severities and extracts by the content toggles", () => {
    const m = buildReportModel(singleRequest("csv", { contents: { ...defaultContents(false), warnings: false, extracts: false } }));
    const issues = m.documents.flatMap((d) => d.issues);
    expect(issues.map((i) => i.severity).sort()).toEqual(["error", "error", "error", "error"]);
    expect(issues.every((i) => i.extract === undefined)).toBe(true);
    // Totals still describe the whole run.
    expect(m.counts.warnings).toBe(1);
  });

  it("lists a shared stylesheet once in bulk runs and counts its pages", () => {
    const m = buildReportModel(bulkRequest("xlsx"));
    expect(m.kind).toBe("bulk");
    expect(m.inputType).toBe("Sitemap");
    const sheets = m.documents.filter((d) => d.origin === "stylesheet");
    expect(sheets).toHaveLength(1);
    expect(sheets[0].linkedFrom).toBe(3);
    expect(m.counts.errors).toBe(1 + 2 + 1); // 3 alt errors + the stylesheet once
    const css = m.issueTypes.find((t) => t.message.includes("colr"));
    expect(css).toMatchObject({ pages: 3, occurrences: 1 });
    const alt = m.issueTypes.find((t) => t.message.includes("alt"));
    expect(alt).toMatchObject({ pages: 2, occurrences: 3 });
    const failed = m.documents.find((d) => d.pageUrl === "https://example.com/p4");
    expect(failed).toMatchObject({ status: "failed", fatal: "Fetch failed: ECONNREFUSED" });
    expect(m.pageCount).toBe(4);
    expect(m.notValidated).toBe(1);
  });
});

describe("CSV", () => {
  it("guards against formula injection and quotes as RFC 4180", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(12)).toBe("12");
    expect(csvCell(undefined)).toBe("");
  });

  it("lists issues only, with a BOM, CRLF and Arabic intact", () => {
    const csv = renderCsv(buildReportModel(singleRequest("csv")));
    expect(csv.startsWith("﻿Issue ID,Page URL,Document,Severity,Type,Message,Line,Column,Extract,Suggested fix,Checker\r\n")).toBe(true);
    const rows = csv.trim().split("\r\n(?=[0-9a-f]{10})");
    expect(csv.split(/\r\n(?=[0-9a-f]{10}[-,])/)).toHaveLength(1 + 6);
    expect(rows[0]).toContain(ARABIC_MENU);
    expect(csv).not.toContain("Executive summary");
  });
});

describe("Excel", () => {
  async function load(request: ReportRequest) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExcel(buildReportModel(request))).buffer as ArrayBuffer);
    return wb;
  }

  it("has the five sheets, each with a frozen, filtered header", async () => {
    const wb = await load(singleRequest("xlsx"));
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Report Info", "Summary", "Issues", "Structure", "Issue Types"]);
    for (const ws of wb.worksheets) {
      expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(ws.autoFilter).toBeTruthy();
    }
  });

  it("fills Report Info with branding, target, run date, totals and score", async () => {
    const ws = (await load(singleRequest("xlsx", { branding: { project: ARABIC_PROJECT, preparedBy: "QA Team", reportDate: "2026-10-09", logo: pngDataUrl } }))).getWorksheet("Report Info")!;
    const info = new Map<string, unknown>();
    ws.eachRow((row, i) => {
      if (i > 1) info.set(String(row.getCell(1).value), row.getCell(2).value);
    });
    expect(info.get("Client / project")).toBe(ARABIC_PROJECT);
    expect(info.get("Prepared by")).toBe("QA Team");
    expect(info.get("Report date")).toBe("2026-10-09");
    expect(info.get("Target")).toBe("https://example.com/ar/");
    expect(info.get("Input type")).toBe("URL");
    expect(info.get("Run date")).toBeInstanceOf(Date);
    expect(info.get("Documents checked")).toBe(2);
    expect(info.get("Errors (total)")).toBe(4);
    expect(info.get("Score")).toBe(79);
    expect(ws.getImages()).toHaveLength(1);
  });

  it("gives Issues an Issue ID, a Status dropdown and a Notes column next to it", async () => {
    const ws = (await load(singleRequest("xlsx"))).getWorksheet("Issues")!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header[0]).toBe("Issue ID");
    expect(header.slice(-2)).toEqual(["Status", "Notes"]);
    expect(ws.rowCount).toBe(1 + 6);
    expect(ws.getCell("A2").value).toMatch(/^[0-9a-f]{10}(-\d+)?$/);
    const statusCol = header.indexOf("Status") + 1;
    const statusCell = ws.getRow(2).getCell(statusCol);
    expect(statusCell.value).toBe("Open");
    expect(statusCell.dataValidation).toMatchObject({ type: "list", formulae: [`"${ISSUE_STATUSES.join(",")}"`] });
    expect(ws.getRow(7).getCell(statusCol).dataValidation?.type).toBe("list");
  });

  it("uses right-to-left reading order for cells with Arabic text only", async () => {
    const wb = await load(singleRequest("xlsx"));
    const issues = wb.getWorksheet("Issues")!;
    const header = (issues.getRow(1).values as unknown[]).slice(1);
    const messageCol = header.indexOf("Message") + 1;
    let arabic = 0;
    issues.eachRow((row, i) => {
      if (i === 1) return;
      const cell = row.getCell(messageCol);
      const hasArabic = /[؀-ۿ]/.test(String(cell.value));
      expect(cell.alignment?.readingOrder === "rtl", String(cell.value)).toBe(hasArabic);
      if (hasArabic) arabic++;
    });
    expect(arabic).toBe(2);
    const info = wb.getWorksheet("Report Info")!;
    info.eachRow((row) => {
      if (row.getCell(1).value === "Client / project") expect(row.getCell(2).alignment?.readingOrder).toBe("rtl");
    });
  });

  it("aggregates a bulk run (Summary per document, Issue Types with pages)", async () => {
    const wb = await load(bulkRequest("xlsx"));
    const summary = wb.getWorksheet("Summary")!;
    expect(summary.rowCount).toBe(1 + 5); // 3 pages + shared stylesheet once + failed page
    const types = wb.getWorksheet("Issue Types")!;
    const css = types.getRows(2, types.rowCount - 1)!.find((r) => String(r.getCell(1).value).includes("colr"))!;
    expect(css.getCell(4).value).toBe(3);
    expect(css.getCell(5).value).toBe(1);
  });
});

describe("HTML", () => {
  it("escapes document content and isolates bidi text", () => {
    const run = arabicRun();
    run.documents[0].messages.push(msg({ severity: "error", message: "Bad <script>alert(1)</script>", extract: '<img src=x onerror="alert(1)">' }));
    const html = renderHtml(buildReportModel({ ...singleRequest("html"), source: { kind: "single", run } }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain(`<bdi dir="auto">${esc(ARABIC_PROJECT)}</bdi>`);
    expect(html).toMatch(/<pre class="extract" dir="auto">/);
    expect(html).toContain("unicode-bidi: isolate");
    expect(html).toContain("Noto Sans Arabic");
    expect(html).toContain(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`);
    expect(html).toContain(ARABIC_HEADING);
  });

  it("follows the content toggles", () => {
    const off = renderHtml(buildReportModel(singleRequest("html", { contents: { ...defaultContents(true), summary: false, outline: false, images: false, structure: false } })));
    expect(off).not.toContain("Executive summary");
    expect(off).not.toContain("Heading outline");
    expect(off).not.toContain("Images (");
    expect(off).not.toContain("Appendix");
    const on = renderHtml(buildReportModel(singleRequest("html")));
    for (const s of ["Executive summary", "Top 5 issue types", "Heading outline", "Images (1)", "Appendix: structure"]) expect(on).toContain(s);
  });

  it(`caps each document at ${MAX_GROUPS_PER_DOCUMENT} grouped messages with a note`, () => {
    const messages = Array.from({ length: MAX_GROUPS_PER_DOCUMENT + 7 }, (_, i) => msg({ severity: "error", message: `Error number ${i}` }));
    const run = arabicRun();
    run.documents = [doc({ label: "https://example.com/big", url: "https://example.com/big", messages })];
    const html = renderHtml(buildReportModel({ ...singleRequest("html"), source: { kind: "single", run } }));
    expect(html.match(/<div class="msg /g)).toHaveLength(MAX_GROUPS_PER_DOCUMENT);
    expect(html).toContain(`Showing the first 500 of 507 message groups for this document. 7 more groups are listed in the Excel, CSV and JSON reports.`);
  });

  it("labels bulk reports and lists the most common issues site-wide", () => {
    const html = renderHtml(buildReportModel(bulkRequest("html", true)));
    expect(html).toContain("Site validation report");
    expect(html).toContain("Most common issues site-wide");
    expect(html).toContain("The bulk run was cancelled");
  });
});

describe("JSON", () => {
  it("is versioned and leaves the logo bytes out", () => {
    const json = JSON.parse(renderJson(buildReportModel(singleRequest("json", { branding: { project: "P", preparedBy: "", reportDate: "2026-10-09", logo: pngDataUrl } }))));
    expect(json).toMatchObject({ schema: "markuplens-report", version: 1, branding: { project: "P", hasLogo: true } });
    expect(JSON.stringify(json)).not.toContain("base64");
    expect(json.documents[0].issues).toHaveLength(5);
    expect(json.documents[0].structure.outline).toHaveLength(1);
  });
});

describe("file names", () => {
  it("builds an ASCII slug and a UTF-8 Content-Disposition", () => {
    expect(slugify("https://www.Example.com/ar/page?x=1")).toBe("www.example.com-ar-page-x-1");
    expect(reportFilename("xlsx", { project: "Acme Site", target: "https://a.b", date: "2026-10-09" })).toBe("markuplens-acme-site-2026-10-09.xlsx");
    expect(reportFilename("pdf", { project: ARABIC_PROJECT, target: "https://example.com/", date: "2026-10-09" })).toBe("markuplens-example.com-2026-10-09.pdf");
    expect(contentDisposition("r é.pdf")).toBe(`attachment; filename="r _.pdf"; filename*=UTF-8''r%20%C3%A9.pdf`);
  });
});
