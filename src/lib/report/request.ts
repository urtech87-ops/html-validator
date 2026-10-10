import type { BulkPage } from "@/lib/bulk/aggregate";
import { MAX_BULK_URLS } from "@/lib/bulk/types";
import type { RunResult } from "@/lib/validation/types";
import { checkLogoDataUrl } from "./logo";
import {
  CONTENT_KEYS,
  REPORT_FORMATS,
  defaultContents,
  type ReportBranding,
  type ReportContents,
  type ReportFormat,
  type ReportRequest,
  type ReportSource,
} from "./types";

/**
 * Parse an untrusted POST /api/report body. In the `source` form the run data
 * comes from the browser, so every field that reaches a report is type-checked
 * here; anything rendered later is escaped again.
 */

export class ReportRequestError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max).trim() : "");

function parseContents(input: unknown): ReportContents {
  const base = defaultContents(false);
  if (!isObject(input)) return base;
  const out = { ...base };
  for (const key of CONTENT_KEYS) if (typeof input[key] === "boolean") out[key] = input[key] as boolean;
  return out;
}

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function parseBranding(input: unknown, now: Date): ReportBranding {
  const b = isObject(input) ? input : {};
  const date = str(b.reportDate, 10);
  const branding: ReportBranding = {
    project: str(b.project, 120),
    preparedBy: str(b.preparedBy, 120),
    reportDate: /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : todayIso(now),
  };
  if (typeof b.logo === "string" && b.logo !== "") {
    const logo = checkLogoDataUrl(b.logo);
    if (!logo.ok) throw new ReportRequestError(logo.error);
    branding.logo = logo.dataUrl;
  }
  return branding;
}

function isMessageList(v: unknown): boolean {
  return Array.isArray(v) && v.every((m) => isObject(m) && typeof m.message === "string" && typeof m.severity === "string");
}

/** Shallow structural check of a RunResult; deep fields are read defensively by the report model. */
function isRun(v: unknown): v is RunResult {
  return (
    isObject(v) &&
    isObject(v.input) &&
    isObject(v.counts) &&
    Array.isArray(v.documents) &&
    v.documents.every((d) => isObject(d) && typeof d.label === "string" && isObject(d.counts) && isMessageList(d.messages))
  );
}

function parseSource(input: unknown): ReportSource {
  if (!isObject(input)) throw new ReportRequestError("“source” is missing.");
  if (input.kind === "single") {
    if (!isRun(input.run)) throw new ReportRequestError("“source.run” is not a validation result.");
    return { kind: "single", run: input.run };
  }
  if (input.kind === "bulk") {
    if (!Array.isArray(input.pages) || input.pages.length === 0) throw new ReportRequestError("“source.pages” must be a non-empty array.");
    if (input.pages.length > MAX_BULK_URLS) throw new ReportRequestError(`A bulk report is limited to ${MAX_BULK_URLS} pages.`);
    const pages: BulkPage[] = input.pages.map((p, i) => {
      if (!isObject(p) || typeof p.url !== "string") throw new ReportRequestError(`Page ${i + 1} is malformed.`);
      if (p.run !== undefined && !isRun(p.run)) throw new ReportRequestError(`Page ${i + 1} has a malformed result.`);
      const status = (["queued", "running", "done", "error", "cancelled"] as const).find((s) => s === p.status) ?? "cancelled";
      return { index: i, url: p.url.slice(0, 2048), status, run: p.run as RunResult | undefined, error: typeof p.error === "string" ? p.error : undefined };
    });
    return {
      kind: "bulk",
      target: str(input.target, 2048) || "URL list",
      mode: input.mode === "sitemap" ? "sitemap" : "url-list",
      pages,
      startedAt: typeof input.startedAt === "string" && !Number.isNaN(Date.parse(input.startedAt)) ? input.startedAt : new Date().toISOString(),
      cancelled: input.cancelled === true,
    };
  }
  throw new ReportRequestError("“source.kind” must be \"single\" or \"bulk\".");
}

/** Format, contents and branding of a report request (everything except what the report is about). */
export function parseReportOptions(body: unknown, now = new Date()): Omit<ReportRequest, "source"> {
  if (!isObject(body)) throw new ReportRequestError("Request body must be a JSON object.");
  const format = REPORT_FORMATS.find((f) => f === body.format) as ReportFormat | undefined;
  if (!format) throw new ReportRequestError(`“format” must be one of: ${REPORT_FORMATS.join(", ")}.`);
  return { format, contents: parseContents(body.contents), branding: parseBranding(body.branding, now) };
}

export function parseReportRequest(body: unknown, now = new Date()): ReportRequest {
  const options = parseReportOptions(body, now);
  return { ...options, source: parseSource((body as Record<string, unknown>).source) };
}
