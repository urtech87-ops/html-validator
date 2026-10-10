/**
 * History types and limits (client-safe).
 */
import type { BulkPage } from "@/lib/bulk/aggregate";
import type { ValidationOptions } from "@/lib/validation/options";
import type { DocumentKind, MessageCounts, RunResult } from "@/lib/validation/types";

/** Document sources kept per saved run (and the largest re-run input that is kept). Bulk runs also drop sources over 300 KB. */
export const MAX_SAVED_SOURCE_BYTES = 10 * 1024 * 1024;
/** Saved reports per run; older ones are deleted first. */
export const MAX_REPORTS_PER_RUN = 20;
/** Reports larger than this are downloaded but not saved. */
export const MAX_SAVED_REPORT_BYTES = 100 * 1024 * 1024;
export const HISTORY_PAGE_SIZE = 25;

export type RunKind = "single" | "bulk";
export type RunInputType = "url" | "upload" | "html" | "css" | "sitemap" | "url-list";
export type RunStatus = "running" | "done" | "cancelled" | "interrupted";

export const INPUT_TYPE_LABEL: Record<RunInputType, string> = {
  url: "URL",
  upload: "File upload",
  html: "Direct input (HTML)",
  css: "Direct input (CSS)",
  sitemap: "Bulk: sitemap",
  "url-list": "Bulk: URL list",
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  done: "Finished",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

/** What is needed to run the same validation again. */
export type RerunInput =
  | { type: "url"; value: string }
  | { type: "html" | "css"; value: string; fragment: boolean }
  | { type: "upload"; files: Array<{ name: string; kind: DocumentKind; base64: string }> }
  | { type: "bulk"; mode: "sitemap" | "url-list"; target: string; urls: string[]; concurrency: number };

/** A saved bulk run (the results blob of a bulk Run row). */
export interface SavedBulk {
  mode: "sitemap" | "url-list";
  /** Sitemap URL or "URL list". */
  target: string;
  concurrency: number;
  startedAt: string;
  cancelled: boolean;
  durationMs?: number;
  pages: BulkPage[];
}

export type SavedRunData = { kind: "single"; run: RunResult } | { kind: "bulk"; bulk: SavedBulk };

/** One row of the history table (no results). */
export interface RunSummaryRow {
  id: string;
  createdAt: string;
  finishedAt?: string;
  kind: RunKind;
  inputType: RunInputType;
  target: string;
  targetKey: string;
  status: RunStatus;
  score?: number;
  passed?: boolean;
  counts: MessageCounts;
  pageCount: number;
  pagesDone: number;
  durationMs?: number;
  engineVersion?: string;
  sizeBytes: number;
  reportCount: number;
  canRerun: boolean;
}

export interface SavedReportRow {
  id: string;
  runId: string;
  createdAt: string;
  format: string;
  filename: string;
  sizeBytes: number;
}

export interface SavedRun {
  summary: RunSummaryRow;
  options: ValidationOptions;
  data: SavedRunData;
  reports: SavedReportRow[];
}

export const SORTS = ["newest", "oldest", "score-asc", "score-desc", "errors", "target"] as const;
export type HistorySort = (typeof SORTS)[number];

export const SORT_LABEL: Record<HistorySort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  "score-asc": "Lowest score",
  "score-desc": "Highest score",
  errors: "Most errors",
  target: "Target (A–Z)",
};

export const TYPE_FILTERS = ["all", "url", "upload", "direct", "bulk"] as const;
export type HistoryTypeFilter = (typeof TYPE_FILTERS)[number];

export const RESULT_FILTERS = ["all", "passed", "errors", "incomplete"] as const;
export type HistoryResultFilter = (typeof RESULT_FILTERS)[number];

export interface HistoryQuery {
  search: string;
  type: HistoryTypeFilter;
  result: HistoryResultFilter;
  sort: HistorySort;
  page: number;
}

export interface HistoryPage {
  rows: RunSummaryRow[];
  total: number;
  page: number;
  pageCount: number;
  /** All runs in history and their stored size, for the footer line. */
  totals: { runs: number; bytes: number };
}

function pickParam<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Parse URL search params (page or API) into a query. */
export function parseHistoryQuery(params: Record<string, string | string[] | undefined>): HistoryQuery {
  const rawSearch = Array.isArray(params.q) ? params.q[0] : params.q;
  const rawPage = Number.parseInt(String((Array.isArray(params.page) ? params.page[0] : params.page) ?? "1"), 10);
  return {
    search: (rawSearch ?? "").trim().slice(0, 200),
    type: pickParam(params.type, TYPE_FILTERS, "all"),
    result: pickParam(params.result, RESULT_FILTERS, "all"),
    sort: pickParam(params.sort, SORTS, "newest"),
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}
