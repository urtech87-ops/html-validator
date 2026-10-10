import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { BulkPage } from "@/lib/bulk/aggregate";
import { compareRuns, CompareError, optionDifferences } from "@/lib/history/compare";
import { renderCompareExcel } from "@/lib/history/compare-excel";
import { normalizeTargetUrl, singleTargetKey, siteKey } from "@/lib/history/target-key";
import type { RunSummaryRow, SavedRun } from "@/lib/history/types";
import { buildReportModel, issueId } from "@/lib/report/model";
import { defaultContents } from "@/lib/report/types";
import { DEFAULT_OPTIONS, type ValidationOptions } from "@/lib/validation/options";
import type { DocumentResult, RunResult } from "@/lib/validation/types";
import { ARABIC_HEADING, doc, msg } from "../helpers/report-fixtures";

const URL_A = "https://example.com/";
const CSS = "https://example.com/site.css";

function run(documents: DocumentResult[], createdAt: string, target = URL_A): RunResult {
  return {
    id: `run-${createdAt}`,
    createdAt,
    input: { type: "url", target },
    documents,
    counts: { errors: 0, warnings: 0, info: 0 },
    score: documents[0]?.score ?? 0,
    passed: true,
    durationMs: 10,
  };
}

function summary(over: Partial<RunSummaryRow>): RunSummaryRow {
  return {
    id: "x",
    createdAt: "2026-10-01T10:00:00.000Z",
    kind: "single",
    inputType: "url",
    target: URL_A,
    targetKey: singleTargetKey("url", URL_A),
    status: "done",
    counts: { errors: 0, warnings: 0, info: 0 },
    pageCount: 1,
    pagesDone: 1,
    sizeBytes: 0,
    reportCount: 0,
    canRerun: true,
    ...over,
  };
}

function savedSingle(id: string, createdAt: string, documents: DocumentResult[], options: ValidationOptions = DEFAULT_OPTIONS): SavedRun {
  const r = run(documents, createdAt);
  return { summary: summary({ id, createdAt, score: r.score }), options, data: { kind: "single", run: r }, reports: [] };
}

function savedBulk(id: string, createdAt: string, pages: BulkPage[], status: RunSummaryRow["status"] = "done"): SavedRun {
  return {
    summary: summary({ id, createdAt, kind: "bulk", inputType: "url-list", target: "URL list", targetKey: siteKey(pages.map((p) => p.url)), status, pageCount: pages.length }),
    options: DEFAULT_OPTIONS,
    data: { kind: "bulk", bulk: { mode: "url-list", target: "URL list", concurrency: 3, startedAt: createdAt, cancelled: status !== "done", pages } },
    reports: [],
  };
}

const page = (messages: ReturnType<typeof msg>[], extra: Partial<DocumentResult> = {}) => doc({ id: "page", label: URL_A, url: URL_A, messages, ...extra });
const sheet = (messages: ReturnType<typeof msg>[], url = CSS) => doc({ id: "css-1", label: url, url, kind: "css", origin: "stylesheet", messages });

describe("target keys", () => {
  it("normalise URLs and group runs of the same thing", () => {
    expect(normalizeTargetUrl("HTTPS://Example.COM:443/a?b=1#top")).toBe("https://example.com/a?b=1");
    expect(singleTargetKey("url", "https://example.com/#x")).toBe(singleTargetKey("url", "https://EXAMPLE.com/"));
    expect(singleTargetKey("upload", "b.html, a.css", ["b.html", "a.css"])).toBe(singleTargetKey("upload", "", ["a.css", "b.html"]));
    expect(singleTargetKey("html", "Direct input")).toBe("direct:html");
    expect(siteKey(["https://a.test/1", "https://b.test/1", "https://b.test/2"])).toBe("site:https://b.test");
    expect(siteKey(["https://a.test/1"], "https://c.test/sitemap.xml")).toBe("site:https://c.test");
  });
});

describe("compareRuns: single runs", () => {
  const dupA = msg({ severity: "error", message: "Duplicate ID “menu”.", extract: '<ul id="menu">', firstLine: 10 });
  const dupB = msg({ severity: "error", message: "Duplicate ID “menu”.", extract: '<ul id="menu">', firstLine: 20 });
  const center = msg({ severity: "error", message: "The “center” element is obsolete.", extract: "<center>", firstLine: 5 });
  const alt = msg({ severity: "error", message: "An “img” element must have an “alt” attribute.", extract: '<img src="a.png">', firstLine: 7 });
  const lang = msg({ severity: "warning", message: "Consider adding a “lang” attribute.", extract: "<html>", firstLine: 2 });

  const before = savedSingle("a", "2026-10-01T10:00:00.000Z", [page([dupA, dupB, center, lang])]);
  const after = savedSingle("b", "2026-10-02T10:00:00.000Z", [
    page([
      // Same duplicate, moved down (line numbers don't matter), only one of the two left.
      { ...dupA, firstLine: 30 },
      alt,
      { ...lang, severity: "error" as const },
    ]),
  ]);

  it("classifies new / fixed / unchanged by Issue ID, ignoring line numbers", () => {
    const result = compareRuns(before, after);
    expect(result.totals).toEqual({ new: 1, fixed: 2, unchanged: 2, severityChanged: 1 });
    const byChange = (c: string) => result.issues.filter((i) => i.change === c).map((i) => i.message);
    expect(byChange("new")).toEqual([alt.message]);
    expect(byChange("fixed").sort()).toEqual([center.message, dupB.message].sort());
    expect(result.issues.find((i) => i.change === "unchanged" && i.message === dupA.message)?.line).toBe(30);
  });

  it("uses the Excel Issue IDs, including the -2 suffix for duplicates", () => {
    const result = compareRuns(before, after);
    const id = issueId(URL_A, dupA.message, dupA.extract);
    const fixedDup = result.issues.find((i) => i.change === "fixed" && i.message === dupA.message)!;
    expect(fixedDup.id).toBe(`${id}-2`);
    expect(result.issues.find((i) => i.change === "unchanged" && i.message === dupA.message)!.id).toBe(id);
    // The same IDs as the report model (Excel "Issue ID" column).
    const model = buildReportModel({ format: "xlsx", contents: defaultContents(true), branding: { project: "", preparedBy: "", reportDate: "2026-10-01" }, source: { kind: "single", run: (before.data as { run: RunResult }).run } });
    expect(model.documents[0].issues.map((i) => i.id)).toContain(`${id}-2`);
  });

  it("notes severity changes and orders runs by date whichever way they are passed", () => {
    const result = compareRuns(after, before);
    expect(result.before.id).toBe("a");
    expect(result.after.id).toBe("b");
    const changed = result.issues.find((i) => i.message === lang.message)!;
    expect([changed.severityBefore, changed.severityAfter]).toEqual(["warning", "error"]);
    expect(result.notes.join(" ")).toMatch(/changed severity/);
  });

  it("warns when the runs used different options", () => {
    const verbose = savedSingle("c", "2026-10-03T10:00:00.000Z", [page([])], { ...DEFAULT_OPTIONS, verbose: true, css: { ...DEFAULT_OPTIONS.css, warningLevel: "all" } });
    const result = compareRuns(before, verbose);
    expect(result.optionDifferences).toEqual([
      { option: "Verbose output (info messages)", before: "off", after: "on" },
      { option: "CSS warning level", before: "normal", after: "all" },
    ]);
    expect(result.notes[0]).toMatch(/different validation options/);
    // Display-only options don't count.
    expect(optionDifferences(DEFAULT_OPTIONS, { ...DEFAULT_OPTIONS, showSource: false, grouping: "by-type" })).toEqual([]);
  });

  it("lists documents found in only one run without counting their issues, and fatal ones as not comparable", () => {
    const a = savedSingle("a", "2026-10-01T10:00:00.000Z", [page([center]), sheet([msg({ severity: "error", message: "Parse error", extract: "colr: red" })])]);
    const b = savedSingle("b", "2026-10-02T10:00:00.000Z", [page([center]), sheet([], "https://example.com/new.css")]);
    const result = compareRuns(a, b);
    expect(result.documents.map((d) => [d.document, d.status])).toEqual([
      [URL_A, "compared"],
      ["https://example.com/new.css", "added"],
      [CSS, "removed"],
    ]);
    expect(result.totals).toMatchObject({ new: 0, fixed: 0, unchanged: 1 });

    const failed = savedSingle("c", "2026-10-03T10:00:00.000Z", [page([], { fatal: "The server returned HTTP 500." })]);
    const r2 = compareRuns(a, failed);
    expect(r2.documents[0]).toMatchObject({ status: "not-comparable", reason: "Later run: The server returned HTTP 500." });
    expect(r2.totals.fixed).toBe(0);
  });

  it("refuses to compare a run with itself or a single run with a bulk run", () => {
    expect(() => compareRuns(before, before)).toThrow(CompareError);
    expect(() => compareRuns(before, savedBulk("z", "2026-10-05T00:00:00.000Z", []))).toThrow(/bulk/);
  });

  it("notes when the targets differ", () => {
    const other = { ...after, summary: { ...after.summary, target: "https://other.test/", targetKey: singleTargetKey("url", "https://other.test/") } };
    expect(compareRuns(before, other).notes.join(" ")).toMatch(/different targets/);
  });
});

describe("compareRuns: bulk runs", () => {
  const sharedError = msg({ severity: "error", message: "Property “colr” doesn't exist.", extract: "colr: red", category: "css" });
  const p = (url: string, messages: ReturnType<typeof msg>[], withCss = true): BulkPage => ({
    index: 0,
    url,
    status: "done",
    run: run([doc({ id: "page", label: url, url, messages }), ...(withCss ? [sheet([sharedError])] : [])], "2026-10-01T00:00:00.000Z", url),
  });
  const obsolete = msg({ severity: "error", message: "The “center” element is obsolete.", extract: "<center>" });

  it("matches pages by URL, compares a shared stylesheet once, and lists added / removed / not comparable pages", () => {
    const a = savedBulk("a", "2026-10-01T00:00:00.000Z", [
      p("https://example.com/1", [obsolete]),
      p("https://example.com/2", []),
      p("https://example.com/gone", []),
      { index: 3, url: "https://example.com/broken", status: "error", error: "Fetch failed" },
    ]);
    const b = savedBulk("b", "2026-10-02T00:00:00.000Z", [
      p("https://example.com/1", []),
      p("https://example.com/2#frag", [obsolete]),
      p("https://example.com/new", []),
      p("https://example.com/broken", []),
    ]);
    const result = compareRuns(a, b);
    expect(result.pages).toEqual({
      compared: 2,
      added: ["https://example.com/new"],
      removed: ["https://example.com/gone"],
      notComparable: [{ url: "https://example.com/broken", reason: "Earlier run: Fetch failed" }],
    });
    // Page 1 fixed the obsolete element, page 2 introduced it; the stylesheet error is unchanged and counted once.
    expect(result.totals).toEqual({ new: 1, fixed: 1, unchanged: 1, severityChanged: 0 });
    const css = result.documents.filter((d) => d.role === "stylesheet");
    expect(css).toHaveLength(1);
    expect(css[0]).toMatchObject({ status: "compared", unchanged: 1, linkedFrom: 4 });
    expect(result.notes.join(" ")).toMatch(/stylesheet linked from many pages/);
  });

  it("treats pages a cancelled run never checked as not comparable", () => {
    const a = savedBulk("a", "2026-10-01T00:00:00.000Z", [p("https://example.com/1", [])]);
    const b = savedBulk("b", "2026-10-02T00:00:00.000Z", [{ index: 0, url: "https://example.com/1", status: "cancelled" }], "cancelled");
    const result = compareRuns(a, b);
    expect(result.pages?.notComparable[0].reason).toMatch(/cancelled/);
    expect(result.notes.join(" ")).toMatch(/later run was cancelled/);
  });
});

describe("comparison Excel", () => {
  it("has Comparison Info, Pages and Issues sheets with frozen, filtered headers, coloured changes and RTL cells", async () => {
    const before = savedSingle("a", "2026-10-01T10:00:00.000Z", [page([msg({ severity: "error", message: "Old problem", extract: "<center>" })])]);
    const after = savedSingle("b", "2026-10-02T10:00:00.000Z", [page([msg({ severity: "error", message: `Duplicate ID “${ARABIC_HEADING}”.`, extract: `<p id="${ARABIC_HEADING}">` })])], {
      ...DEFAULT_OPTIONS,
      verbose: true,
    });
    const result = compareRuns(before, after);
    const bytes = await renderCompareExcel(result, { project: "شركة المثال", preparedBy: "QA", reportDate: "2026-10-10" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Comparison Info", "Pages", "Issues"]);
    for (const ws of wb.worksheets) {
      expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(ws.autoFilter).toBeTruthy();
    }

    const info = wb.getWorksheet("Comparison Info")!;
    const values = new Map<string, unknown>();
    info.eachRow((row, n) => n > 1 && values.set(String(row.getCell(1).value).trim(), row.getCell(2).value));
    expect(values.get("Client / project")).toBe("شركة المثال");
    expect(values.get("New issues")).toBe(1);
    expect(values.get("Fixed issues")).toBe(1);
    expect(values.get("Unchanged issues")).toBe(0);
    expect(String(values.get("Options difference"))).toMatch(/different validation options/);
    expect(values.get("Verbose output (info messages)")).toBe("off → on");

    const issues = wb.getWorksheet("Issues")!;
    const header = issues.getRow(1).values as unknown[];
    expect(header.slice(1)).toEqual([
      "Issue ID",
      "Page URL",
      "Document",
      "Change",
      "Severity before",
      "Severity after",
      "Message",
      "Line",
      "Extract",
      "Suggested fix",
      "Status",
      "Notes",
    ]);
    const rows = [2, 3].map((n) => issues.getRow(n));
    const newRow = rows.find((r) => r.getCell(4).value === "New")!;
    const fixedRow = rows.find((r) => r.getCell(4).value === "Fixed")!;
    expect((newRow.getCell(4).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFDE2E1");
    expect((fixedRow.getCell(4).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFDCFCE7");
    expect(fixedRow.getCell(11).value).toBe("Fixed");
    expect(newRow.getCell(11).value).toBe("Open");
    expect(newRow.getCell(7).alignment?.readingOrder).toBe("rtl");
    expect(newRow.getCell(11).dataValidation).toMatchObject({ type: "list", formulae: ['"Open,Fixed,Won\'t fix"'] });

    const pages = wb.getWorksheet("Pages")!;
    expect(pages.getRow(2).getCell(4).value).toBe("Yes");
    expect(pages.getRow(2).getCell(7).value).toBe(1);
  });
});
