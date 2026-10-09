import type { RunResult } from "@/lib/validation/types";

/** Bulk mode limits (client-safe). */
export const MAX_BULK_URLS = 200;
export const DEFAULT_CONCURRENCY = 3;
export const MAX_CONCURRENCY = 6;
/** In bulk runs, document sources above this size are dropped to keep the browser responsive. */
export const BULK_MAX_SOURCE_BYTES = 300 * 1024;

export type PageStatus = "queued" | "running" | "done" | "error" | "cancelled";

/** One line of the NDJSON stream from POST /api/bulk. */
export type BulkEvent =
  | { type: "start"; total: number; concurrency: number }
  | { type: "page-start"; index: number; url: string }
  | { type: "page-done"; index: number; url: string; run: RunResult }
  | { type: "page-error"; index: number; url: string; error: string }
  | { type: "end"; cancelled: boolean; durationMs: number };

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

export interface SitemapDiscovery {
  /** What the user entered. */
  input: string;
  /** Every location tried, in order, with the outcome. */
  tried: Array<{ url: string; outcome: "found" | "not-found" | "error"; detail?: string }>;
  /** Sitemap files that were read (including child sitemaps of an index). */
  sitemaps: string[];
  urls: SitemapUrl[];
  /** More URLs existed than MAX_DISCOVERED_URLS. */
  truncated: boolean;
  warnings: string[];
}
