"use client";

import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleAlert, FileJson, FileSpreadsheet, Loader2, Search, TriangleAlert } from "lucide-react";
import { prefsStore } from "@/components/report/report-dialog";
import { Extract } from "@/components/results/extract";
import { SeverityIcon } from "@/components/results/severity";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadComparison } from "@/lib/client/history-client";
import { CHANGE_LABEL, DOCUMENT_STATUS_LABEL, type CompareResult, type CompareRunInfo, type IssueChange } from "@/lib/history/compare-types";
import { INPUT_TYPE_LABEL, STATUS_LABEL } from "@/lib/history/types";
import { LocalTime } from "./local-time";

const PAGE = 200;

const CHANGE_STYLE: Record<IssueChange, string> = {
  new: "bg-destructive/10 text-destructive",
  fixed: "bg-success/12 text-success",
  unchanged: "bg-muted text-muted-foreground",
};

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RunCard({ label, run }: { label: string; run: CompareRunInfo }) {
  return (
    <Card className="min-w-0 flex-1">
      <CardContent className="space-y-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <Link href={`/history/${run.id}`} className="block truncate font-mono text-[13px] underline-offset-4 hover:underline" title={run.target} dir="auto">
          {run.target}
        </Link>
        <p className="text-sm text-muted-foreground">
          <LocalTime iso={run.createdAt} /> · {INPUT_TYPE_LABEL[run.inputType]}
          {run.status !== "done" && <> · {STATUS_LABEL[run.status]}</>}
        </p>
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{run.score ?? "—"}</span>
          <span className="text-muted-foreground"> {run.kind === "bulk" ? "average score" : "score"}</span>
          <span className="ml-3 text-muted-foreground tabular-nums">
            {run.counts.errors} errors · {run.counts.warnings} warnings
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, className }: { label: string; value: number | string; className: string }) {
  return (
    <div className={`rounded-lg px-4 py-3 ${className}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm">{label}</div>
    </div>
  );
}

export function CompareView({ result }: { result: CompareResult }) {
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, prefsStore.getServerSnapshot);
  const [change, setChange] = useState<IssueChange | "all">("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [download, setDownload] = useState<{ busy?: "json" | "xlsx"; error?: string; name?: string }>({});
  const deferredSearch = useDeferredValue(search);

  const { before, after, totals } = result;
  const scoreDelta = before.score !== undefined && after.score !== undefined ? after.score - before.score : undefined;

  const issues = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return result.issues.filter(
      (i) => (change === "all" || i.change === change) && (!q || i.message.toLowerCase().includes(q) || i.document.toLowerCase().includes(q) || i.id.startsWith(q)),
    );
  }, [result.issues, change, deferredSearch]);

  const save = async (format: "json" | "xlsx") => {
    setDownload({ busy: format });
    try {
      const name = await downloadComparison(before.id, after.id, format, { project: prefs.project.trim(), preparedBy: prefs.preparedBy.trim(), reportDate: todayLocal() });
      setDownload({ name });
    } catch (err) {
      setDownload({ error: err instanceof Error ? err.message : "The download failed." });
    }
  };

  return (
    <div className="space-y-4">
      <Link href="/history" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> History
      </Link>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Compare runs</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void save("json")} disabled={!!download.busy}>
            {download.busy === "json" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileJson aria-hidden="true" />} Download JSON
          </Button>
          <Button onClick={() => void save("xlsx")} disabled={!!download.busy}>
            {download.busy === "xlsx" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />} Download comparison (Excel)
          </Button>
        </div>
      </div>
      <div aria-live="polite">
        {download.error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{download.error}</AlertDescription>
          </Alert>
        )}
        {download.name && <p className="text-sm text-success">Downloaded <span className="font-mono text-xs">{download.name}</span></p>}
      </div>

      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
        <RunCard label="Earlier run" run={before} />
        <ArrowRight className="hidden size-5 shrink-0 text-muted-foreground md:block" aria-hidden="true" />
        <RunCard label="Later run" run={after} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="New issues" value={totals.new} className="bg-destructive/8 text-destructive" />
        <Tile label="Fixed issues" value={totals.fixed} className="bg-success/10 text-success" />
        <Tile label="Unchanged" value={totals.unchanged} className="bg-muted text-foreground" />
        <Tile label="Score change" value={scoreDelta === undefined ? "—" : `${scoreDelta > 0 ? "+" : ""}${scoreDelta}`} className="bg-muted text-foreground" />
      </div>

      {result.optionDifferences.length > 0 && (
        <Alert>
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>The runs used different options</AlertTitle>
          <AlertDescription>
            <p>Some changes may come from the options rather than from edits to the pages.</p>
            <ul className="mt-1 list-disc pl-5">
              {result.optionDifferences.map((d) => (
                <li key={d.option}>
                  {d.option}: {d.before} → {d.after}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {result.notes.filter((n) => !n.startsWith("The runs used different validation options")).length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {result.notes
            .filter((n) => !n.startsWith("The runs used different validation options"))
            .map((n) => (
              <li key={n}>{n}</li>
            ))}
        </ul>
      )}

      {result.pages && (
        <p className="text-sm text-muted-foreground">
          {result.pages.compared} page{result.pages.compared === 1 ? "" : "s"} compared · {result.pages.added.length} only in the later run ·{" "}
          {result.pages.removed.length} only in the earlier run · {result.pages.notComparable.length} not comparable
        </p>
      )}

      <section aria-labelledby="compare-docs" className="space-y-2">
        <h2 id="compare-docs" className="font-heading text-lg font-semibold">
          {result.kind === "bulk" ? "Pages and stylesheets" : "Documents"}
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Document</th>
                <th scope="col" className="px-3 py-2 font-medium">Comparison</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Score</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">New</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Fixed</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Unchanged</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.documents.map((d) => (
                <tr key={d.key} className="align-top">
                  <td className="max-w-96 px-3 py-2">
                    <span className="block truncate font-mono text-[12.5px]" title={d.document} dir="auto">
                      {d.document}
                    </span>
                    {d.role === "stylesheet" && (
                      <span className="text-xs text-muted-foreground">
                        Stylesheet{d.linkedFrom && d.linkedFrom > 1 ? ` · linked from ${d.linkedFrom} pages, compared once` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={d.status === "compared" ? "" : "text-warning-foreground"}>{DOCUMENT_STATUS_LABEL[d.status]}</span>
                    {d.reason && <span className="block text-xs text-muted-foreground">{d.reason}</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {d.scoreBefore ?? "—"} → {d.scoreAfter ?? "—"}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${d.new ? "text-destructive" : ""}`}>{d.status === "compared" ? d.new : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${d.fixed ? "text-success" : ""}`}>{d.status === "compared" ? d.fixed : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.status === "compared" ? d.unchanged : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="compare-issues" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="compare-issues" className="font-heading text-lg font-semibold">
            Issues
          </h2>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search issues"
              placeholder="Message, document or Issue ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(PAGE);
              }}
              className="pl-8"
            />
          </div>
        </div>
        <Tabs
          value={change}
          onValueChange={(v) => {
            setChange(v as IssueChange | "all");
            setLimit(PAGE);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">All ({result.issues.length})</TabsTrigger>
            <TabsTrigger value="new">New ({totals.new})</TabsTrigger>
            <TabsTrigger value="fixed">Fixed ({totals.fixed})</TabsTrigger>
            <TabsTrigger value="unchanged">Unchanged ({totals.unchanged})</TabsTrigger>
          </TabsList>
        </Tabs>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No issues to show.</p>
        ) : (
          <ul className="space-y-2">
            {issues.slice(0, limit).map((i) => (
              <li key={`${i.change}:${i.document}:${i.id}`} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${CHANGE_STYLE[i.change]}`}>{CHANGE_LABEL[i.change]}</span>
                  <SeverityIcon severity={i.severityAfter ?? i.severityBefore ?? "error"} />
                  {i.severityBefore && i.severityAfter && i.severityBefore !== i.severityAfter && (
                    <span className="text-xs text-warning-foreground">
                      {i.severityBefore} → {i.severityAfter}
                    </span>
                  )}
                  <span className="font-mono text-xs text-muted-foreground">{i.id}</span>
                  {i.line !== undefined && <span className="text-xs text-muted-foreground">line {i.line}</span>}
                </div>
                <p className="mt-1.5 break-words" dir="auto">
                  {i.message}
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={i.document}>
                  {i.document}
                </p>
                {i.extract && (
                  <div className="mt-2">
                    <Extract extract={i.extract} hiliteStart={i.hiliteStart} hiliteLength={i.hiliteLength} severity={i.severityAfter ?? i.severityBefore ?? "error"} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {issues.length > limit && (
          <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
            Show more ({(issues.length - limit).toLocaleString("en")} left)
          </Button>
        )}
      </section>
    </div>
  );
}
