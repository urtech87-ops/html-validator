"use client";

import { saveResponse } from "./report-client";

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string };
    return new Error(body.error || `${fallback} (HTTP ${res.status}).`);
  } catch {
    return new Error(`${fallback} (HTTP ${res.status}).`);
  }
}

export async function deleteRunsRequest(ids: string[]): Promise<string[]> {
  const res = await fetch("/api/history", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
  if (!res.ok) throw await errorFrom(res, "The runs could not be deleted");
  return ((await res.json()) as { deleted: string[] }).deleted;
}

/** Re-run a single run on the server; resolves with the new run's id. */
export async function rerunRequest(id: string): Promise<string> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}/rerun`, { method: "POST" });
  if (!res.ok) throw await errorFrom(res, "The run could not be re-run");
  return ((await res.json()) as { runId: string }).runId;
}

export async function deleteReportRequest(id: string): Promise<void> {
  const res = await fetch(`/api/history/reports/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await errorFrom(res, "The report could not be deleted");
}

/** Download the comparison of two runs as JSON or Excel. Resolves with the file name. */
export async function downloadComparison(
  a: string,
  b: string,
  format: "json" | "xlsx",
  branding: { project: string; preparedBy: string; reportDate: string },
): Promise<string> {
  const res = await fetch("/api/history/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a, b, format, branding }),
  });
  if (!res.ok) throw await errorFrom(res, "The comparison could not be downloaded");
  return saveResponse(res, `markuplens-compare.${format}`);
}
