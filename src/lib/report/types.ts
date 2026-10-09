/**
 * Report request types and limits (client-safe). Reports are generated on
 * demand from the run the browser already holds; saving them to history comes
 * with Phase 6.
 */
import type { BulkPage } from "@/lib/bulk/aggregate";
import type { RunResult } from "@/lib/validation/types";

export const REPORT_FORMATS = ["pdf", "xlsx", "html", "json", "csv"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const FORMAT_META: Record<ReportFormat, { label: string; extension: string; mime: string }> = {
  pdf: { label: "PDF", extension: "pdf", mime: "application/pdf" },
  xlsx: { label: "Excel (.xlsx)", extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  html: { label: "HTML (single file)", extension: "html", mime: "text/html; charset=utf-8" },
  json: { label: "JSON", extension: "json", mime: "application/json; charset=utf-8" },
  csv: { label: "CSV (issues)", extension: "csv", mime: "text/csv; charset=utf-8" },
};

export interface ReportContents {
  summary: boolean;
  errors: boolean;
  warnings: boolean;
  info: boolean;
  extracts: boolean;
  structure: boolean;
  outline: boolean;
  images: boolean;
}

export const CONTENT_KEYS = ["summary", "errors", "warnings", "info", "extracts", "structure", "outline", "images"] as const;

/** Everything on, except info messages, which follow the run's Verbose option. */
export function defaultContents(verbose: boolean): ReportContents {
  return { summary: true, errors: true, warnings: true, info: verbose, extracts: true, structure: true, outline: true, images: true };
}

export interface ReportBranding {
  /** Client / project name. */
  project: string;
  preparedBy: string;
  /** YYYY-MM-DD; defaults to the day the report is generated. */
  reportDate: string;
  /** data: URL of a PNG, JPEG or WebP image (≤ 1 MB). */
  logo?: string;
}

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

/** PDF/HTML show at most this many grouped messages per document; Excel/CSV/JSON list everything. */
export const MAX_GROUPS_PER_DOCUMENT = 500;
/** Example locations shown under one grouped message in PDF/HTML. */
export const MAX_EXAMPLES_PER_GROUP = 3;
/** Excel and CSV stop listing issues here (Excel's own limit is ~1M rows). */
export const MAX_ISSUE_ROWS = 200_000;
/** Reject report requests above this size (a 200-page bulk run without sources is far below). */
export const MAX_REPORT_REQUEST_BYTES = 60 * 1024 * 1024;

/** What the report is about: one validation run, or a bulk run of many pages. */
export type ReportSource =
  | { kind: "single"; run: RunResult }
  | {
      kind: "bulk";
      /** Sitemap URL or "URL list". */
      target: string;
      /** "sitemap" or "url-list". */
      mode: "sitemap" | "url-list";
      pages: BulkPage[];
      startedAt: string;
      cancelled: boolean;
    };

export interface ReportRequest {
  format: ReportFormat;
  contents: ReportContents;
  branding: ReportBranding;
  source: ReportSource;
}
