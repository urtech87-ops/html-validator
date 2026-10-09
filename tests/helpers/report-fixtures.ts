import type { BulkPage } from "@/lib/bulk/aggregate";
import { defaultContents, type ReportRequest } from "@/lib/report/types";
import type { DocumentResult, RunResult, ValidationMessage } from "@/lib/validation/types";

/** Arabic words that must survive into reports (PDF text, Excel cells). */
export const ARABIC_HEADING = "مرحبا بالعالم";
export const ARABIC_MENU = "القائمة الرئيسية";
export const ARABIC_PROJECT = "شركة المثال";

let seq = 0;
export function msg(partial: Partial<ValidationMessage> & Pick<ValidationMessage, "severity" | "message">): ValidationMessage {
  return { id: `m${seq++}`, category: "html", source: "vnu", ...partial };
}

export function doc(partial: Partial<DocumentResult> & Pick<DocumentResult, "label">): DocumentResult {
  const messages = partial.messages ?? [];
  const counts = {
    errors: messages.filter((m) => m.severity === "error").length,
    warnings: messages.filter((m) => m.severity === "warning").length,
    info: messages.filter((m) => m.severity === "info").length,
  };
  return {
    id: partial.id ?? `d${seq++}`,
    kind: "html",
    origin: "url",
    source: "",
    sizeBytes: 1200,
    encoding: { name: "utf-8", source: "http-header" },
    doctype: { kind: "html5", label: "HTML5" },
    notices: [],
    messages,
    counts,
    score: Math.max(0, 100 - 5 * counts.errors - counts.warnings),
    passed: counts.errors === 0,
    ...partial,
  };
}

/** A single-page run of an Arabic page: Arabic extracts, an Arabic duplicate-ID message, a structure report. */
export function arabicRun(): RunResult {
  const url = "https://example.com/ar/";
  const page = doc({
    id: "page",
    label: url,
    url,
    httpStatus: 200,
    messages: [
      msg({
        severity: "error",
        message: "Element “center” not allowed as child of element “body” in this context.",
        firstLine: 12,
        firstColumn: 3,
        lastLine: 12,
        lastColumn: 10,
        extract: `<body>\n  <center>${ARABIC_HEADING}</center>`,
        hiliteStart: 9,
        hiliteLength: 8,
      }),
      msg({
        severity: "error",
        message: `Duplicate ID “${ARABIC_MENU}”.`,
        firstLine: 20,
        lastLine: 20,
        lastColumn: 30,
        extract: `<nav id="${ARABIC_MENU}">روابط</nav>`,
        hiliteStart: 0,
        hiliteLength: 10,
      }),
      msg({
        severity: "error",
        message: `Duplicate ID “${ARABIC_MENU}”.`,
        firstLine: 41,
        lastLine: 41,
        lastColumn: 30,
        extract: `<div id="${ARABIC_MENU}">نص عربي</div>`,
      }),
      msg({
        severity: "warning",
        message: "Consider adding a “lang” attribute to the “html” start tag to declare the language of this document.",
        firstLine: 2,
        lastLine: 2,
        extract: "<!DOCTYPE html>\n<html>",
      }),
      msg({ severity: "info", message: "Trailing slash on void elements has no effect.", firstLine: 5, lastLine: 5, extract: '<meta charset="utf-8" />' }),
    ],
    structure: {
      scope: "document",
      checks: [
        { id: "rtl", title: "Right-to-left content", status: "fail", explanation: "Mostly Arabic text, but the page has no dir=\"rtl\".", details: [`Sample: ${ARABIC_HEADING}`] },
        { id: "h1", title: "Single <h1>", status: "pass", explanation: "Exactly one <h1>." },
      ],
      outline: [{ level: 1, text: ARABIC_HEADING, line: 14, issues: [] }],
      images: [{ src: "logo.png", alt: "شعار الشركة", status: "ok", decorative: false, line: 16 }],
      counts: { pass: 1, warning: 0, fail: 1 },
    },
  });
  const css = doc({
    id: "css",
    label: "https://example.com/site.css",
    url: "https://example.com/site.css",
    kind: "css",
    origin: "stylesheet",
    messages: [msg({ severity: "error", category: "css", message: "“colr”: Property “colr” doesn't exist.", firstLine: 1, lastLine: 1, extract: "body { colr: red; }" })],
  });
  const documents = [page, css];
  const counts = {
    errors: page.counts.errors + css.counts.errors,
    warnings: page.counts.warnings + css.counts.warnings,
    info: page.counts.info + css.counts.info,
  };
  return {
    id: "run-ar",
    createdAt: "2026-10-09T10:00:00.000Z",
    input: { type: "url", target: url },
    documents,
    counts,
    score: Math.max(0, 100 - 5 * counts.errors - counts.warnings),
    passed: false,
    engineVersion: "26.10.7",
    durationMs: 900,
  };
}

export function singleRequest(format: ReportRequest["format"], overrides: Partial<ReportRequest> = {}): ReportRequest {
  return {
    format,
    contents: { ...defaultContents(true) },
    branding: { project: ARABIC_PROJECT, preparedBy: "QA Team", reportDate: "2026-10-09" },
    source: { kind: "single", run: arabicRun() },
    ...overrides,
  };
}

/** Three bulk pages sharing one stylesheet, plus one failed page. */
export function bulkPages(): BulkPage[] {
  const shared = () =>
    doc({ id: "css", label: "https://example.com/site.css", url: "https://example.com/site.css", kind: "css", origin: "stylesheet", messages: [msg({ severity: "error", category: "css", message: "“colr”: Property “colr” doesn't exist.", firstLine: 1, lastLine: 1, extract: "body { colr: red; }" })] });
  const page = (n: number, extra: ValidationMessage[]): RunResult => {
    const url = `https://example.com/p${n}`;
    const d = doc({ id: "page", label: url, url, messages: extra });
    const s = shared();
    const counts = { errors: d.counts.errors + s.counts.errors, warnings: d.counts.warnings + s.counts.warnings, info: 0 };
    return { id: `r${n}`, createdAt: "2026-10-09T10:00:00.000Z", input: { type: "url", target: url }, documents: [d, s], counts, score: 100 - 5 * counts.errors - counts.warnings, passed: counts.errors === 0, durationMs: 100 };
  };
  const alt = () => msg({ severity: "error", message: "An “img” element must have an “alt” attribute, except under certain conditions.", firstLine: 3, lastLine: 3, extract: '<img src="x.png">' });
  return [
    { index: 0, url: "https://example.com/p1", status: "done", run: page(1, [alt()]) },
    { index: 1, url: "https://example.com/p2", status: "done", run: page(2, [alt(), alt()]) },
    { index: 2, url: "https://example.com/p3", status: "done", run: page(3, []) },
    { index: 3, url: "https://example.com/p4", status: "error", error: "Fetch failed: ECONNREFUSED" },
  ];
}
