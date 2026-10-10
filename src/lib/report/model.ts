import "server-only";
import { createHash } from "node:crypto";
import { summarizeBulk, type BulkPage } from "@/lib/bulk/aggregate";
import { matchGuide } from "@/lib/guide/messageGuide";
import { SEVERITY_RANK } from "@/lib/validation/view";
import type {
  CheckStatus,
  DocumentKind,
  DocumentOrigin,
  DocumentResult,
  MessageCategory,
  MessageCounts,
  Severity,
  StructureReport,
} from "@/lib/validation/types";
import type { ReportBranding, ReportContents, ReportRequest } from "./types";

/**
 * The normalised report every format renders from. Built once per request
 * from the run the browser sent. Shared stylesheets in bulk runs appear once
 * (attributed to the first page linking them), matching the site totals.
 */

export interface ReportIssue {
  /** Stable ID: short hash of normalised document URL + message + normalised extract (see issueId). */
  id: string;
  /** The page that was validated (for a stylesheet: the first page linking it). */
  pageUrl: string;
  /** URL or name of the document the message is in (the page itself, a stylesheet, a file). */
  document: string;
  documentKind: DocumentKind;
  severity: Severity;
  category: MessageCategory;
  message: string;
  line?: number;
  column?: number;
  extract?: string;
  hiliteStart?: number;
  hiliteLength?: number;
  /** One-line fix from the message guide, if known. */
  fix?: string;
  explanation?: string;
  /** "markuplens" for MarkupLens' own checks (vendor prefixes). */
  checker: "vnu" | "markuplens";
}

export type DocumentStatus = "passed" | "errors" | "not-validated" | "failed" | "cancelled";

export interface ReportDocument {
  key: string;
  /** 0-based page index in the run (bulk), 0 for single runs. */
  pageIndex: number;
  pageUrl: string;
  label: string;
  url?: string;
  kind: DocumentKind;
  origin: DocumentOrigin | "page";
  status: DocumentStatus;
  counts: MessageCounts;
  score?: number;
  fatal?: string;
  httpStatus?: number;
  checkedAt?: string;
  sizeBytes?: number;
  encoding?: string;
  doctype?: string;
  notices: string[];
  /** Number of pages linking this stylesheet (bulk runs). */
  linkedFrom?: number;
  structure?: StructureReport;
  /** Issues in this document, already filtered by the severity toggles. */
  issues: ReportIssue[];
}

export interface IssueType {
  message: string;
  severity: Severity;
  category: MessageCategory;
  /** Number of pages the message appears on. */
  pages: number;
  occurrences: number;
  fix?: string;
}

export interface StructureRow {
  pageUrl: string;
  document: string;
  checkId: string;
  title: string;
  status: CheckStatus;
  explanation: string;
  details: string[];
  affected?: number;
  lines: number[];
}

export interface ReportModel {
  generatedAt: string;
  branding: ReportBranding;
  contents: ReportContents;
  kind: "single" | "bulk";
  /** What was validated: URL, sitemap URL, "URL list", file names, "Direct input". */
  target: string;
  /** "URL", "File upload", "Direct input (HTML)", "Sitemap", "URL list". */
  inputType: string;
  runDate: string;
  engineVersion?: string;
  cancelled: boolean;
  /** Pages in a bulk run; documents in a single run. */
  pageCount: number;
  documentCount: number;
  passed: number;
  failed: number;
  notValidated: number;
  /** Site-wide counts (shared stylesheets once). Not affected by the severity toggles. */
  counts: MessageCounts;
  /** Single run: the run's score. Bulk: mean of per-page scores. */
  averageScore?: number;
  /** Bulk only: score over all site-wide messages. */
  siteScore?: number;
  documents: ReportDocument[];
  issueTypes: IssueType[];
  structureRows: StructureRow[];
  /** Total issues across documents (after severity toggles). */
  issueCount: number;
}

/* ---------------------------------------------------------------- issue IDs */

export function normalizeUrlForId(value: string): string {
  try {
    const u = new URL(value);
    u.hash = "";
    return u.href;
  } catch {
    return value.trim();
  }
}

export function normalizeExtract(extract: string | undefined): string {
  return (extract ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Short, stable issue ID: the first 10 hex digits of SHA-256 over the
 * normalised document URL, the message text and the whitespace-collapsed
 * extract. Line numbers are deliberately left out so the ID survives edits
 * elsewhere in the file (Phase 6 compares runs the same way).
 */
export function issueId(documentUrl: string, message: string, extract: string | undefined): string {
  return createHash("sha256")
    .update(`${normalizeUrlForId(documentUrl)}\n${message}\n${normalizeExtract(extract)}`)
    .digest("hex")
    .slice(0, 10);
}

/* --------------------------------------------------------------- the model */

const INPUT_TYPE: Record<string, string> = { url: "URL", upload: "File upload", html: "Direct input (HTML)", css: "Direct input (CSS)" };

function wanted(contents: ReportContents, s: Severity): boolean {
  return s === "error" ? contents.errors : s === "warning" ? contents.warnings : contents.info;
}

function documentStatus(doc: DocumentResult): DocumentStatus {
  if (doc.fatal) return "not-validated";
  return doc.passed ? "passed" : "errors";
}

/** A document's messages as report issues with stable IDs (duplicates get -2, -3, …). Also used to compare runs. */
export function toIssues(doc: DocumentResult, pageUrl: string, contents: ReportContents): ReportIssue[] {
  const documentRef = doc.url ?? doc.label;
  const seen = new Map<string, number>();
  const issues: ReportIssue[] = [];
  for (const m of doc.messages ?? []) {
    if (!wanted(contents, m.severity)) continue;
    const base = issueId(documentRef, m.message, m.extract);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const guide = matchGuide(m.message);
    issues.push({
      id: n === 1 ? base : `${base}-${n}`,
      pageUrl,
      document: documentRef,
      documentKind: doc.kind,
      severity: m.severity,
      category: m.category,
      message: m.message,
      line: m.firstLine ?? m.lastLine,
      column: m.firstColumn ?? m.lastColumn,
      extract: contents.extracts ? m.extract : undefined,
      hiliteStart: contents.extracts ? m.hiliteStart : undefined,
      hiliteLength: contents.extracts ? m.hiliteLength : undefined,
      fix: guide?.fix,
      explanation: guide?.explanation,
      checker: m.source === "markuplens" ? "markuplens" : "vnu",
    });
  }
  return issues;
}

function toDocument(doc: DocumentResult, page: { index: number; url: string; checkedAt?: string }, contents: ReportContents): ReportDocument {
  return {
    key: doc.origin === "stylesheet" && doc.url ? `css:${doc.url}` : `page:${page.index}:${doc.id}`,
    pageIndex: page.index,
    pageUrl: page.url,
    label: doc.label,
    url: doc.url,
    kind: doc.kind,
    origin: doc.origin,
    status: documentStatus(doc),
    counts: doc.counts,
    score: doc.fatal ? undefined : doc.score,
    fatal: doc.fatal,
    httpStatus: doc.httpStatus,
    checkedAt: page.checkedAt,
    sizeBytes: doc.sizeBytes,
    encoding: doc.fatal ? undefined : doc.encoding?.name,
    doctype: doc.fatal ? undefined : doc.doctype?.label,
    notices: Array.isArray(doc.notices) ? doc.notices : [],
    structure: doc.fatal ? undefined : doc.structure,
    // A document that couldn't be validated only carries its fatal reason (shown as its status), which the
    // site totals leave out too, so it adds no issues.
    issues: doc.fatal ? [] : toIssues(doc, page.url, contents),
  };
}

/** `linkingPages` maps a document key to every page index that included it (shared stylesheets). */
function issueTypes(documents: ReportDocument[], linkingPages: Map<string, Set<number>>): IssueType[] {
  const map = new Map<string, Omit<IssueType, "pages"> & { pageSet: Set<number> }>();
  for (const d of documents) {
    const pagesOfDoc = linkingPages.get(d.key) ?? new Set([d.pageIndex]);
    for (const i of d.issues) {
      const key = `${i.severity}\u0000${i.message}`;
      const t = map.get(key) ?? { message: i.message, severity: i.severity, category: i.category, occurrences: 0, fix: i.fix, pageSet: new Set<number>() };
      t.occurrences++;
      // A shared stylesheet's issue counts for every page linking it.
      for (const p of pagesOfDoc) t.pageSet.add(p);
      map.set(key, t);
    }
  }
  return [...map.values()]
    .map(({ pageSet, ...t }) => ({ ...t, pages: pageSet.size }))
    .sort((a, b) => b.occurrences - a.occurrences || b.pages - a.pages || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.message.localeCompare(b.message));
}

function structureRows(documents: ReportDocument[]): StructureRow[] {
  const rows: StructureRow[] = [];
  for (const d of documents) {
    for (const c of d.structure?.checks ?? []) {
      rows.push({
        pageUrl: d.pageUrl,
        document: d.url ?? d.label,
        checkId: c.id,
        title: c.title,
        status: c.status,
        explanation: c.explanation,
        details: c.details ?? [],
        affected: c.affected,
        lines: (c.locations ?? []).map((l) => l.line),
      });
    }
  }
  return rows;
}

export function buildReportModel(request: ReportRequest, now = new Date()): ReportModel {
  const { source, contents, branding } = request;
  const pages: BulkPage[] =
    source.kind === "single" ? [{ index: 0, url: source.run.input.target, status: "done", run: source.run }] : source.pages;
  const summary = summarizeBulk(pages, 0);

  const documents: ReportDocument[] = [];
  const byKey = new Map<string, ReportDocument>();
  const linkingPages = new Map<string, Set<number>>();
  for (const page of pages) {
    const run = page.run;
    if (!run) {
      // Bulk page that failed outright or never ran.
      documents.push({
        key: `page:${page.index}`,
        pageIndex: page.index,
        pageUrl: page.url,
        label: page.url,
        url: page.url,
        kind: "html",
        origin: "page",
        status: page.status === "error" ? "failed" : "cancelled",
        counts: { errors: 0, warnings: 0, info: 0 },
        fatal: page.error ?? (page.status === "error" ? "The page could not be validated." : "Not checked (run cancelled)."),
        notices: [],
        issues: [],
      });
      continue;
    }
    const pageUrl = source.kind === "single" ? (run.documents[0]?.url ?? run.input.target) : page.url;
    for (const doc of run.documents) {
      // Uploads and direct input: every document is its own "page".
      const docPage = source.kind === "single" && run.input.type !== "url" ? (doc.url ?? doc.label) : pageUrl;
      const d = toDocument(doc, { index: page.index, url: docPage, checkedAt: run.createdAt }, contents);
      const linked = linkingPages.get(d.key) ?? new Set<number>();
      linked.add(page.index);
      linkingPages.set(d.key, linked);
      const existing = byKey.get(d.key);
      if (existing) {
        existing.linkedFrom = linked.size;
        continue;
      }
      if (doc.origin === "stylesheet") d.linkedFrom = 1;
      byKey.set(d.key, d);
      documents.push(d);
    }
  }

  const single = source.kind === "single" ? source.run : undefined;
  const inputType = single ? (INPUT_TYPE[single.input.type] ?? single.input.type) : source.kind === "bulk" && source.mode === "sitemap" ? "Sitemap" : "URL list";
  const target = single
    ? single.input.type === "upload"
      ? single.documents.map((d) => d.label).join(", ")
      : single.input.target
    : source.kind === "bulk"
      ? source.target
      : "";
  const firstRun = pages.find((p) => p.run)?.run;

  return {
    generatedAt: now.toISOString(),
    branding,
    contents,
    kind: source.kind,
    target,
    inputType,
    runDate: single ? single.createdAt : source.kind === "bulk" ? source.startedAt : now.toISOString(),
    engineVersion: firstRun?.engineVersion,
    cancelled: source.kind === "bulk" && source.cancelled,
    pageCount: single ? single.documents.length : pages.length,
    documentCount: documents.length,
    passed: single ? single.documents.filter((d) => !d.fatal && d.passed).length : summary.passed,
    failed: single ? single.documents.filter((d) => !d.fatal && !d.passed).length : summary.failed,
    notValidated: single ? single.documents.filter((d) => d.fatal).length : summary.notValidated,
    counts: single ? single.counts : summary.counts,
    averageScore: single ? single.score : summary.averageScore,
    siteScore: single ? undefined : summary.siteScore,
    documents,
    issueTypes: issueTypes(documents, linkingPages),
    structureRows: contents.structure ? structureRows(documents) : [],
    issueCount: documents.reduce((n, d) => n + d.issues.length, 0),
  };
}

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  passed: "Passed",
  errors: "Errors",
  "not-validated": "Not validated",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const ORIGIN_LABEL: Record<ReportDocument["origin"], string> = {
  url: "Page",
  page: "Page",
  stylesheet: "Stylesheet",
  upload: "Upload",
  direct: "Direct input",
};

export const SEVERITY_LABEL: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Info" };
export const CATEGORY_LABEL: Record<MessageCategory, string> = { html: "HTML", css: "CSS", document: "Document" };
