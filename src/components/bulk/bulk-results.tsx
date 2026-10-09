"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleDashed, CircleMinus, CircleX, Loader2 } from "lucide-react";
import { CountPills, ScoreGauge } from "@/components/results/run-summary";
import { SEVERITY_META } from "@/components/results/severity";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BulkPage, BulkSummary } from "@/lib/bulk/aggregate";
import { formatMs } from "@/lib/format";

type SortKey = "order" | "score" | "errors" | "status";

/** Site-wide summary plus "most common issues". */
export function BulkSummaryCard({ summary }: { summary: BulkSummary }) {
  const validated = summary.passed + summary.failed;
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {summary.averageScore !== undefined && (
            <div className="flex items-center gap-3">
              <ScoreGauge score={summary.averageScore} />
              <div className="text-xs text-muted-foreground">
                Average score
                <br />
                across {validated} page{validated === 1 ? "" : "s"}
              </div>
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <h2 id="bulk-summary-heading" tabIndex={-1} className="font-heading text-lg font-semibold outline-none">
              Site summary
            </h2>
            <CountPills counts={summary.counts} />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-success">{summary.passed} passed</span> ·{" "}
              <span className="font-medium text-destructive">{summary.failed} with errors</span>
              {summary.notValidated > 0 && <> · {summary.notValidated} could not be validated</>}
            </p>
          </div>
        </div>

        {summary.commonIssues.length > 0 && (
          <section aria-labelledby="common-issues-heading" className="space-y-2">
            <h3 id="common-issues-heading" className="text-sm font-semibold">
              Most common issues site-wide
            </h3>
            <ol className="divide-y rounded-lg border text-sm">
              {summary.commonIssues.map((issue) => {
                const meta = SEVERITY_META[issue.severity];
                return (
                  <li key={`${issue.severity}:${issue.message}`} className="flex items-start gap-2.5 px-3 py-2">
                    <meta.Icon className={`mt-0.5 size-4 shrink-0 ${meta.text}`} aria-label={meta.label} role="img" />
                    <span className="min-w-0 flex-1 break-words">{issue.message}</span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      <span className="font-semibold text-foreground">{issue.pages}</span> page{issue.pages === 1 ? "" : "s"}
                      <br />×{issue.occurrences}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_ORDER: Record<BulkPage["status"], number> = { error: 0, running: 1, queued: 2, done: 3, cancelled: 4 };

function StatusCell({ page }: { page: BulkPage }) {
  const fatal = page.run?.documents[0]?.fatal;
  if (page.status === "queued") return <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleDashed className="size-4" aria-hidden="true" />Queued</span>;
  if (page.status === "running") return <span className="inline-flex items-center gap-1 text-info"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Running</span>;
  if (page.status === "cancelled") return <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleMinus className="size-4" aria-hidden="true" />Cancelled</span>;
  if (page.status === "error" || fatal) return <span className="inline-flex items-center gap-1 text-destructive"><CircleX className="size-4" aria-hidden="true" />{fatal ? "Not validated" : "Failed"}</span>;
  return page.run!.passed ? (
    <span className="inline-flex items-center gap-1 text-success"><CircleCheck className="size-4" aria-hidden="true" />Passed</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-destructive"><CircleX className="size-4" aria-hidden="true" />Errors</span>
  );
}

/** Per-page table; clicking a row opens that page's full results. */
export function BulkPageTable({ pages, selected, onSelect }: { pages: BulkPage[]; selected?: number; onSelect: (index: number) => void }) {
  const [sort, setSort] = useState<SortKey>("order");
  const rows = useMemo(() => {
    const list = [...pages];
    const score = (p: BulkPage) => (p.run && !p.run.documents[0]?.fatal ? p.run.score : -1);
    if (sort === "score") list.sort((a, b) => score(a) - score(b) || a.index - b.index);
    if (sort === "errors") list.sort((a, b) => (b.run?.counts.errors ?? -1) - (a.run?.counts.errors ?? -1) || a.index - b.index);
    if (sort === "status") list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || score(a) - score(b) || a.index - b.index);
    return list;
  }, [pages, sort]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold">Pages</h2>
        <div className="flex items-center gap-2 text-sm">
          <span id="bulk-sort-label" className="text-muted-foreground">
            Sort by
          </span>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-40" aria-labelledby="bulk-sort-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="order">Run order</SelectItem>
              <SelectItem value="score">Lowest score</SelectItem>
              <SelectItem value="errors">Most errors</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <caption className="sr-only">Validated pages. Select a row to see its full results.</caption>
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2 font-medium">#</th>
              <th scope="col" className="px-3 py-2 font-medium">Page</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Score</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Errors</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Warnings</th>
              <th scope="col" className="px-3 py-2 font-medium">Structure</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((p) => {
              const doc = p.run?.documents[0];
              const fatal = doc?.fatal;
              const canOpen = p.status === "done" || p.status === "error";
              const isSelected = selected === p.index;
              return (
                <tr key={p.index} className={`${isSelected ? "bg-primary/8" : canOpen ? "hover:bg-muted/40" : ""} align-top`}>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{p.index + 1}</td>
                  <td className="max-w-80 px-3 py-2">
                    {canOpen ? (
                      <button
                        type="button"
                        onClick={() => onSelect(p.index)}
                        aria-pressed={isSelected}
                        className="block max-w-full truncate rounded-sm text-left font-mono text-[12.5px] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        title={p.url}
                      >
                        {p.url}
                      </button>
                    ) : (
                      <span className="block truncate font-mono text-[12.5px] text-muted-foreground" title={p.url}>
                        {p.url}
                      </span>
                    )}
                    {(fatal || p.error) && <span className="mt-0.5 block text-xs text-destructive">{fatal ?? p.error}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap"><StatusCell page={p} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.run && !fatal ? p.run.score : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${p.run && !fatal && p.run.counts.errors ? SEVERITY_META.error.text : ""}`}>
                    {p.run && !fatal ? p.run.counts.errors : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.run && !fatal ? p.run.counts.warnings : "—"}</td>
                  <td className="px-3 py-2">{doc?.structure && !fatal ? <span className="text-xs tabular-nums">{doc.structure.counts.fail} fail · {doc.structure.counts.warning} warn</span> : "—"}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">{p.run ? formatMs(p.run.durationMs) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

