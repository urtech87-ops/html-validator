import "server-only";
import { RunCancelledError } from "@/lib/abort";
import type { ValidationOptions } from "@/lib/validation/options";
import { validateUrl, type RunContext } from "@/lib/validation/run";
import type { RunResult } from "@/lib/validation/types";
import { BULK_MAX_SOURCE_BYTES, type BulkEvent } from "./types";

/** Drop large document sources so 200 pages don't overwhelm the browser. */
export function slimRun(run: RunResult, maxSourceBytes = BULK_MAX_SOURCE_BYTES): RunResult {
  return {
    ...run,
    documents: run.documents.map((d) =>
      d.sizeBytes > maxSourceBytes && d.source ? { ...d, source: "", sourceOmitted: true } : d,
    ),
  };
}

export type ValidateFn = (url: string, options: ValidationOptions, ctx: RunContext) => Promise<RunResult>;

/**
 * Validate many URLs with a concurrency limit, emitting an event as each page
 * starts and finishes. When `signal` fires, no new pages start, in-flight
 * fetches and vnu calls are aborted, and "end" reports cancelled: true.
 */
export async function runBulk(
  urls: string[],
  options: ValidationOptions,
  concurrency: number,
  emit: (event: BulkEvent) => void,
  signal: AbortSignal,
  validate: ValidateFn = validateUrl,
): Promise<void> {
  const started = performance.now();
  const ctx: RunContext = { signal, stylesheetCache: new Map() };
  emit({ type: "start", total: urls.length, concurrency });

  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < urls.length) {
      const index = next++;
      const url = urls[index];
      emit({ type: "page-start", index, url });
      try {
        const run = await validate(url, options, ctx);
        if (signal.aborted) return;
        emit({ type: "page-done", index, url, run: slimRun(run) });
      } catch (err) {
        if (err instanceof RunCancelledError || signal.aborted) return;
        emit({ type: "page-error", index, url, error: err instanceof Error ? err.message : "Validation failed." });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, urls.length)) }, worker));
  emit({ type: "end", cancelled: signal.aborted, durationMs: Math.round(performance.now() - started) });
}
