"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleAlert, GitCompareArrows, X } from "lucide-react";
import { BulkPageTable, BulkSummaryCard } from "@/components/bulk/bulk-results";
import { ReportDialog } from "@/components/report/report-dialog";
import { ResultsView } from "@/components/results/results-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { summarizeBulk } from "@/lib/bulk/aggregate";
import { formatBytes, formatMs } from "@/lib/format";
import { INPUT_TYPE_LABEL, STATUS_LABEL, type SavedRun } from "@/lib/history/types";
import { USER_AGENTS } from "@/lib/validation/options";
import { ResultBadge } from "./history-browser";
import { LocalTime } from "./local-time";
import { DeleteRunsButton, RerunButton } from "./run-buttons";
import { SavedReports } from "./saved-reports";

/** /history/[id]: header with actions, the saved results, and saved reports. */
export function SavedRunView({ saved, previousId }: { saved: SavedRun; previousId?: string }) {
  const router = useRouter();
  const { summary, options, data } = saved;
  const [error, setError] = useState<string>();
  const running = summary.status === "running";

  // A bulk run still in progress (started in another tab): refresh until it finishes.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  const report = (
    <ReportDialog
      runId={summary.id}
      verbose={options.verbose}
      disabled={running}
      label={running ? "Report (after the run)" : "Generate report"}
      onSaved={() => router.refresh()}
    />
  );

  return (
    <div className="space-y-4">
      <Link href="/history" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> History
      </Link>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Saved run · {INPUT_TYPE_LABEL[summary.inputType]}
              </p>
              <h1 className="font-heading text-xl font-semibold break-all sm:text-2xl" dir="auto">
                {summary.target}
              </h1>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <LocalTime iso={summary.createdAt} />
                <ResultBadge run={summary} />
                {summary.kind === "bulk" && (
                  <span>
                    {summary.pagesDone} / {summary.pageCount} pages
                  </span>
                )}
                {summary.durationMs !== undefined && <span>{formatMs(summary.durationMs)}</span>}
                <span>{formatBytes(summary.sizeBytes)} stored</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <RerunButton run={summary} size="default" onError={setError} />
              {previousId ? (
                <Button variant="outline" asChild>
                  <Link href={`/history/compare?a=${previousId}&b=${summary.id}`}>
                    <GitCompareArrows aria-hidden="true" /> Compare with previous run
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" disabled title="There is no earlier run of the same target.">
                  <GitCompareArrows aria-hidden="true" /> Compare with previous run
                </Button>
              )}
              <DeleteRunsButton ids={[summary.id]} size="default" disabled={running} onDeleted={() => router.push("/history")} />
            </div>
          </div>
          <OptionsLine saved={saved} />
          {summary.status !== "done" && summary.status !== "running" && (
            <p className="text-sm text-muted-foreground">
              This run was {STATUS_LABEL[summary.status].toLowerCase()} before every page was checked; the pages it finished are saved.
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {data.kind === "single" ? (
        <ResultsView run={data.run} options={options} actions={report} />
      ) : (
        <SavedBulk saved={saved} report={report} />
      )}

      <SavedReports reports={saved.reports} />
    </div>
  );
}

function OptionsLine({ saved }: { saved: SavedRun }) {
  const o = saved.options;
  const parts = [
    `Encoding: ${o.encoding.override === "auto" ? "auto-detect" : `${o.encoding.override}${o.encoding.onlyIfMissing ? " (if missing)" : ""}`}`,
    `User-Agent: ${USER_AGENTS[o.userAgent].label}`,
    `Verbose: ${o.verbose ? "on" : "off"}`,
    `Error pages: ${o.validateErrorPages ? "validated" : "reported"}`,
    `CSS warnings: ${o.css.warningLevel}`,
    `Vendor prefixes: ${o.css.vendorPrefixes === "warn" ? "warn" : "ignore"}`,
  ];
  if (saved.data.kind === "bulk") parts.push(`Pages at a time: ${saved.data.bulk.concurrency}`);
  return <p className="text-xs text-muted-foreground">Options — {parts.join(" · ")}</p>;
}

function SavedBulk({ saved, report }: { saved: SavedRun; report: React.ReactNode }) {
  const bulk = saved.data.kind === "bulk" ? saved.data.bulk : undefined;
  const pages = useMemo(() => bulk?.pages ?? [], [bulk]);
  const summary = useMemo(() => summarizeBulk(pages), [pages]);
  const [selected, setSelected] = useState<number>();
  const detailRef = useRef<HTMLDivElement>(null);
  const page = selected !== undefined ? pages[selected] : undefined;

  useEffect(() => {
    if (page) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [page]);

  return (
    <div className="space-y-4">
      {summary.passed + summary.failed > 0 ? (
        <BulkSummaryCard summary={summary} action={report} />
      ) : (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            No page of this run was validated.
            {report}
          </CardContent>
        </Card>
      )}
      <BulkPageTable pages={pages} selected={selected} onSelect={setSelected} />
      {page && (
        <div ref={detailRef} className="scroll-mt-20 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate font-heading text-lg font-semibold">
              Page {page.index + 1}: <span className="font-mono text-base">{page.url}</span>
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setSelected(undefined)}>
              <X aria-hidden="true" /> Close
            </Button>
          </div>
          {page.run ? (
            <ResultsView key={page.run.id} run={page.run} options={saved.options} />
          ) : (
            <Alert variant="destructive">
              <AlertDescription>{page.error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
