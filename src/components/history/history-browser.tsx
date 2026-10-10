"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleMinus, CircleX, GitCompareArrows, Loader2, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatBytes } from "@/lib/format";
import {
  INPUT_TYPE_LABEL,
  SORTS,
  SORT_LABEL,
  STATUS_LABEL,
  type HistoryPage,
  type HistoryQuery,
  type HistoryResultFilter,
  type HistoryTypeFilter,
  type RunSummaryRow,
} from "@/lib/history/types";
import { LocalTime } from "./local-time";
import { DeleteRunsButton, RerunButton } from "./run-buttons";

const TYPE_LABEL: Record<HistoryTypeFilter, string> = { all: "All types", url: "URL", upload: "File upload", direct: "Direct input", bulk: "Bulk" };
const RESULT_LABEL: Record<HistoryResultFilter, string> = { all: "Any result", passed: "Passed", errors: "With errors", incomplete: "Cancelled / interrupted" };

function toParams(q: HistoryQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set("q", q.search);
  if (q.type !== "all") p.set("type", q.type);
  if (q.result !== "all") p.set("result", q.result);
  if (q.sort !== "newest") p.set("sort", q.sort);
  if (q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function ResultBadge({ run }: { run: RunSummaryRow }) {
  if (run.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-info">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Running
      </span>
    );
  }
  if (run.status !== "done") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <CircleMinus className="size-4" aria-hidden="true" /> {STATUS_LABEL[run.status]}
      </span>
    );
  }
  if (run.passed === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <CircleX className="size-4" aria-hidden="true" /> Not validated
      </span>
    );
  }
  return run.passed ? (
    <span className="inline-flex items-center gap-1 text-success">
      <CircleCheck className="size-4" aria-hidden="true" /> Passed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-destructive">
      <CircleX className="size-4" aria-hidden="true" /> Errors
    </span>
  );
}

export function HistoryBrowser({ page, query }: { page: HistoryPage; query: HistoryQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.search);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const go = (next: Partial<HistoryQuery>) => {
    setSelected([]);
    startTransition(() => router.push(`${pathname}${toParams({ ...query, page: 1, ...next })}`));
  };
  const refresh = () => startTransition(() => router.refresh());

  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  const selectedRows = page.rows.filter((r) => selected.includes(r.id));
  const canCompare = selectedRows.length === 2 && selectedRows[0].kind === selectedRows[1].kind;
  const allOnPage = page.rows.length > 0 && page.rows.every((r) => selected.includes(r.id));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <form
            role="search"
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              go({ search: search.trim() });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="history-search">Search</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="history-search"
                  type="search"
                  dir="auto"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="URL, file name or run ID"
                  className="pl-8"
                />
              </div>
            </div>
            <FilterSelect id="history-type" label="Type" value={query.type} options={TYPE_LABEL} onChange={(type) => go({ type })} />
            <FilterSelect id="history-result" label="Result" value={query.result} options={RESULT_LABEL} onChange={(result) => go({ result })} />
            <FilterSelect
              id="history-sort"
              label="Sort"
              value={query.sort}
              options={Object.fromEntries(SORTS.map((s) => [s, SORT_LABEL[s]])) as Record<HistoryQuery["sort"], string>}
              onChange={(sort) => go({ sort })}
            />
            <button type="submit" className="sr-only">
              Search
            </button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {pending ? "Loading…" : `${page.total.toLocaleString("en")} run${page.total === 1 ? "" : "s"}${query.search || query.type !== "all" || query.result !== "all" ? " match" : ""}`}
          {selected.length > 0 && ` · ${selected.length} selected`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canCompare}
            title={selected.length === 2 && !canCompare ? "A single-page run can't be compared with a bulk run." : "Select two runs to compare."}
            onClick={() => router.push(`/history/compare?a=${selectedRows[0].id}&b=${selectedRows[1].id}`)}
          >
            <GitCompareArrows aria-hidden="true" /> Compare selected
          </Button>
          <DeleteRunsButton
            ids={selected}
            label={selected.length > 1 ? `Delete ${selected.length}` : "Delete selected"}
            onDeleted={() => {
              setSelected([]);
              refresh();
            }}
          />
        </div>
      </div>

      {page.rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {page.totals.runs === 0 ? (
              <>
                No runs yet. Every validation is saved here — start on the <Link href="/" className="underline underline-offset-4">Validate</Link> or{" "}
                <Link href="/bulk" className="underline underline-offset-4">Bulk</Link> page.
              </>
            ) : (
              "No runs match these filters."
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <caption className="sr-only">Saved validation runs</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2">
                  <Checkbox
                    aria-label="Select all runs on this page"
                    checked={allOnPage}
                    onCheckedChange={(v) => setSelected(v === true ? page.rows.map((r) => r.id) : [])}
                  />
                </th>
                <th scope="col" className="px-3 py-2 font-medium">Target</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">Date</th>
                <th scope="col" className="px-3 py-2 font-medium">Result</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Score</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Errors</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Warnings</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Reports</th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.rows.map((r) => (
                <tr key={r.id} className={`align-top ${selected.includes(r.id) ? "bg-primary/8" : "hover:bg-muted/40"}`}>
                  <td className="px-3 py-2.5">
                    <Checkbox aria-label={`Select ${r.target}`} checked={selected.includes(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} />
                  </td>
                  <td className="max-w-80 px-3 py-2.5">
                    <Link
                      href={`/history/${r.id}`}
                      className="block truncate rounded-sm font-mono text-[12.5px] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      title={r.target}
                      dir="auto"
                    >
                      {r.target}
                    </Link>
                    {r.kind === "bulk" && (
                      <span className="text-xs text-muted-foreground">
                        {r.pagesDone} / {r.pageCount} pages
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{INPUT_TYPE_LABEL[r.inputType]}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <LocalTime iso={r.createdAt} />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <ResultBadge run={r} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.score ?? "—"}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${r.counts.errors ? "text-destructive" : ""}`}>{r.counts.errors}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.counts.warnings}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.reportCount || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <RerunButton run={r} onError={setError} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          History holds {page.totals.runs.toLocaleString("en")} run{page.totals.runs === 1 ? "" : "s"} ({formatBytes(page.totals.bytes)}). The oldest are deleted
          automatically when the limits are reached.
        </p>
        {page.pageCount > 1 && (
          <nav aria-label="Pagination" className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page.page <= 1} onClick={() => go({ page: page.page - 1 })}>
              <ChevronLeft aria-hidden="true" /> Previous
            </Button>
            <span className="tabular-nums">
              Page {page.page} of {page.pageCount}
            </span>
            <Button variant="outline" size="sm" disabled={page.page >= page.pageCount} onClick={() => go({ page: page.page + 1 })}>
              Next <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}

function FilterSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full md:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(options) as T[]).map((k) => (
            <SelectItem key={k} value={k}>
              {options[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
