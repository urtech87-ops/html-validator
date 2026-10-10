"use client";

import type { BulkEvent, SitemapDiscovery } from "@/lib/bulk/types";
import type { ValidationOptions } from "@/lib/validation/options";

async function errorFrom(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string };
    return new Error(body.error || `Request failed (HTTP ${res.status}).`);
  } catch {
    return new Error(`Request failed (HTTP ${res.status}).`);
  }
}

export async function discoverSitemapRequest(url: string, options: ValidationOptions, signal?: AbortSignal): Promise<SitemapDiscovery> {
  const res = await fetch("/api/sitemap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, options }),
    signal,
  });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as SitemapDiscovery;
}

/**
 * Start a bulk run and call `onEvent` for every NDJSON line as it arrives.
 * Abort `signal` to cancel: the server stops the queue when the connection closes.
 */
export async function streamBulkRun(
  urls: string[],
  options: ValidationOptions,
  concurrency: number,
  onEvent: (event: BulkEvent) => void,
  signal: AbortSignal,
  /** The sitemap the URLs came from (saved with the run). */
  sitemap?: string,
): Promise<void> {
  const res = await fetch("/api/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, options, concurrency, mode: sitemap ? "sitemap" : "url-list", sitemap }),
    signal,
  });
  if (!res.ok || !res.body) throw await errorFrom(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as BulkEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as BulkEvent);
}

/** A saved bulk run's input, for "Re-run" (GET /api/history/:id/input). */
export interface BulkRerunInput {
  mode: "sitemap" | "url-list";
  target: string;
  urls: string[];
  concurrency: number;
  options: ValidationOptions;
}

export async function loadBulkRerunInput(id: string, signal?: AbortSignal): Promise<BulkRerunInput> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}/input`, { signal });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as BulkRerunInput;
}
