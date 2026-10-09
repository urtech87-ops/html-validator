"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, ListPlus, Map as MapIcon, X } from "lucide-react";
import { ReportDialog } from "@/components/report/report-dialog";
import { ResultsView } from "@/components/results/results-view";
import { OptionsPanel } from "@/components/validate/options-panel";
import { useOptions } from "@/components/validate/settings-store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { summarizeBulk, type BulkPage } from "@/lib/bulk/aggregate";
import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, type BulkEvent } from "@/lib/bulk/types";
import { streamBulkRun } from "@/lib/client/bulk-client";
import type { ValidationOptions } from "@/lib/validation/options";
import { BulkPageTable, BulkSummaryCard } from "./bulk-results";
import { BulkProgress } from "./bulk-progress";
import { SitemapPicker } from "./sitemap-picker";
import { UrlListForm } from "./url-list-form";

interface RunState {
  pages: BulkPage[];
  options: ValidationOptions;
  /** For reports: the sitemap that was read, or "URL list". */
  target: string;
  mode: "sitemap" | "url-list";
  running: boolean;
  cancelled: boolean;
  startedAt: number;
  finishedMs?: number;
  error?: string;
}

export function BulkApp() {
  const [options] = useOptions();
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const [run, setRun] = useState<RunState | null>(null);
  const [selected, setSelected] = useState<number>();
  const controller = useRef<AbortController | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Stop a running bulk job when leaving the page.
  useEffect(() => () => controller.current?.abort(), []);

  const apply = useCallback((event: BulkEvent) => {
    setRun((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.slice();
      switch (event.type) {
        case "page-start":
          pages[event.index] = { ...pages[event.index], status: "running" };
          return { ...prev, pages };
        case "page-done":
          pages[event.index] = { ...pages[event.index], status: "done", run: event.run };
          return { ...prev, pages };
        case "page-error":
          pages[event.index] = { ...pages[event.index], status: "error", error: event.error };
          return { ...prev, pages };
        case "end":
          return {
            ...prev,
            running: false,
            cancelled: event.cancelled,
            finishedMs: Date.now() - prev.startedAt,
            pages: pages.map((p) => (p.status === "queued" || p.status === "running" ? { ...p, status: "cancelled" } : p)),
          };
        default:
          return prev;
      }
    });
  }, []);

  const start = useCallback(
    async (urls: string[], sitemap?: string) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setSelected(undefined);
      setRun({
        pages: urls.map((url, index) => ({ index, url, status: "queued" })),
        options,
        target: sitemap ?? "URL list",
        mode: sitemap ? "sitemap" : "url-list",
        running: true,
        cancelled: false,
        startedAt: Date.now(),
      });
      requestAnimationFrame(() => document.getElementById("bulk-run")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      try {
        await streamBulkRun(urls, options, concurrency, apply, ac.signal);
      } catch (err) {
        if (ac.signal.aborted) {
          apply({ type: "end", cancelled: true, durationMs: 0 });
          return;
        }
        setRun((prev) => (prev ? { ...prev, error: err instanceof Error ? err.message : "The bulk run failed." } : prev));
        apply({ type: "end", cancelled: true, durationMs: 0 });
      }
    },
    [options, concurrency, apply],
  );

  const cancel = () => controller.current?.abort();

  const summary = useMemo(() => (run ? summarizeBulk(run.pages) : undefined), [run]);
  const selectedPage = run && selected !== undefined ? run.pages[selected] : undefined;

  useEffect(() => {
    if (selectedPage) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedPage?.index]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = !!run?.running;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <Tabs defaultValue="sitemap">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="sitemap">
                <MapIcon aria-hidden="true" /> Sitemap
              </TabsTrigger>
              <TabsTrigger value="list">
                <ListPlus aria-hidden="true" /> URL list
              </TabsTrigger>
            </TabsList>
            <TabsContent value="sitemap" className="pt-3">
              <SitemapPicker busy={busy} onSubmit={start} />
            </TabsContent>
            <TabsContent value="list" className="pt-3">
              <UrlListForm busy={busy} onSubmit={(urls) => start(urls)} />
            </TabsContent>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Label htmlFor="bulk-concurrency" className="font-normal">
              Pages at a time
            </Label>
            <Select value={String(concurrency)} onValueChange={(v) => setConcurrency(Number(v))} disabled={busy}>
              <SelectTrigger id="bulk-concurrency" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_CONCURRENCY }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                    {n === DEFAULT_CONCURRENCY ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Higher is faster but puts more load on the site and the validator.</span>
          </div>
          <OptionsPanel />
        </CardContent>
      </Card>

      {run && summary && (
        <section id="bulk-run" aria-label="Bulk run" className="scroll-mt-20 space-y-4">
          <Card>
            <CardContent>
              <BulkProgress
                summary={summary}
                running={run.running}
                startedAt={run.startedAt}
                finishedMs={run.finishedMs}
                cancelled={run.cancelled}
                onCancel={cancel}
              />
            </CardContent>
          </Card>

          {run.error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>The bulk run stopped</AlertTitle>
              <AlertDescription>{run.error}</AlertDescription>
            </Alert>
          )}

          {summary.passed + summary.failed > 0 && (
            <BulkSummaryCard
              summary={summary}
              action={
                <ReportDialog
                  label={run.running ? "Report (after the run)" : "Generate report"}
                  disabled={run.running}
                  verbose={run.options.verbose}
                  source={() => ({
                    kind: "bulk",
                    target: run.target,
                    mode: run.mode,
                    pages: run.pages,
                    startedAt: new Date(run.startedAt).toISOString(),
                    cancelled: run.cancelled,
                  })}
                />
              }
            />
          )}

          <BulkPageTable pages={run.pages} selected={selected} onSelect={setSelected} />

          {selectedPage && (
            <div ref={detailRef} className="scroll-mt-20 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 truncate font-heading text-lg font-semibold">
                  Page {selectedPage.index + 1}: <span className="font-mono text-base">{selectedPage.url}</span>
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setSelected(undefined)}>
                  <X aria-hidden="true" /> Close
                </Button>
              </div>
              {selectedPage.run ? (
                <ResultsView key={selectedPage.run.id} run={selectedPage.run} options={run.options} />
              ) : (
                <Alert variant="destructive">
                  <AlertDescription>{selectedPage.error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
