"use client";

import type { ReportRequest, ReportSource } from "@/lib/report/types";
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

/** POST /api/report and save the returned file. Resolves with the file name. */
export async function downloadReport(request: ReportRequest, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, source: slimSource(request.source) }),
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
  const blob = await res.blob();
  const name = filenameFrom(res.headers.get("Content-Disposition"), `markuplens-report.${request.format}`);
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
