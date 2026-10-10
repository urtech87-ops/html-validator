"use client";

import type { ReportRequest, ReportSource } from "@/lib/report/types";

/** A report of a saved run: the server loads the run from history and saves the file. */
export type RunReportRequest = Omit<ReportRequest, "source"> & { runId: string };

export interface DownloadedReport {
  name: string;
  /** Set when the report was saved to history (X-Report-Id). */
  reportId?: string;
  /** Why a report of a saved run wasn't saved (e.g. over 100 MB). */
  notSaved?: string;
}
import type { RunResult } from "@/lib/validation/types";

/** Reports don't need document sources (extracts are in the messages); dropping them keeps the upload small. */
function withoutSources(run: RunResult): RunResult {
  return { ...run, documents: run.documents.map((d) => ({ ...d, source: "", sourceOmitted: true })) };
}

export function slimSource(source: ReportSource): ReportSource {
  if (source.kind === "single") return { kind: "single", run: withoutSources(source.run) };
  return { ...source, pages: source.pages.map((p) => (p.run ? { ...p, run: withoutSources(p.run) } : p)) };
}

function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // fall through to the ASCII name
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? fallback;
}

/** Save a response body as a download (the browser's "save file"). */
export async function saveResponse(res: Response, fallback: string): Promise<string> {
  const blob = await res.blob();
  const name = filenameFrom(res.headers.get("Content-Disposition"), fallback);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/** POST /api/report and save the returned file. */
export async function downloadReport(request: ReportRequest | RunReportRequest, signal?: AbortSignal): Promise<DownloadedReport> {
  const body = "runId" in request ? request : { ...request, source: slimSource(request.source) };
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = `The report could not be generated (HTTP ${res.status}).`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  const name = await saveResponse(res, `markuplens-report.${request.format}`);
  return { name, reportId: res.headers.get("X-Report-Id") ?? undefined, notSaved: res.headers.get("X-Report-Not-Saved") ?? undefined };
}
