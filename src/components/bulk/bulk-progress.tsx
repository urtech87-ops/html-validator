"use client";

import { useEffect, useState } from "react";
import { CircleStop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { BulkSummary } from "@/lib/bulk/aggregate";
import { formatMs } from "@/lib/format";

/** Progress bar, live counters, elapsed time and the Cancel button. */
export function BulkProgress({
  summary,
  running,
  startedAt,
  finishedMs,
  cancelled,
  onCancel,
}: {
  summary: BulkSummary;
  running: boolean;
  startedAt: number;
  finishedMs?: number;
  cancelled: boolean;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const pct = summary.total ? Math.round((summary.finished / summary.total) * 100) : 0;
  const elapsed = finishedMs ?? Math.max(0, now - startedAt);
  const { byStatus } = summary;
  const status = running
    ? `Validating… ${summary.finished} of ${summary.total} pages done`
    : cancelled
      ? `Cancelled after ${summary.finished - byStatus.cancelled} of ${summary.total} pages`
      : `Finished: ${summary.total} pages`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">
          {status}
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          <span>{formatMs(elapsed)}</span>
          {running && (
            <Button variant="destructive" size="sm" onClick={onCancel}>
              <CircleStop aria-hidden="true" /> Cancel
            </Button>
          )}
        </div>
      </div>
      <Progress value={pct} aria-label="Bulk validation progress" aria-valuetext={`${pct}%`} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Page status counts">
        <li>
          <span className="font-semibold text-foreground tabular-nums">{byStatus.done}</span> done
        </li>
        <li>
          <span className="font-semibold text-foreground tabular-nums">{byStatus.running}</span> running
        </li>
        <li>
          <span className="font-semibold text-foreground tabular-nums">{byStatus.queued}</span> queued
        </li>
        {byStatus.error > 0 && (
          <li className="text-destructive">
            <span className="font-semibold tabular-nums">{byStatus.error}</span> failed
          </li>
        )}
        {byStatus.cancelled > 0 && (
          <li>
            <span className="font-semibold text-foreground tabular-nums">{byStatus.cancelled}</span> cancelled
          </li>
        )}
      </ul>
    </div>
  );
}
