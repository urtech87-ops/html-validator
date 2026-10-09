"use client";

import { useId, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleMinus, CircleX, Loader2, Map as MapIcon, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/validate/submit-button";
import { useOptions } from "@/components/validate/settings-store";
import { MAX_BULK_URLS, type SitemapDiscovery } from "@/lib/bulk/types";
import { discoverSitemapRequest } from "@/lib/client/bulk-client";

/** Rows rendered at once; the rest are reachable through the filter or "Show more". */
const PAGE = 300;

const OUTCOME_ICON = {
  found: <CircleCheck className="size-3.5 text-success" aria-label="Found" />,
  "not-found": <CircleMinus className="size-3.5 text-muted-foreground" aria-label="Not found" />,
  error: <CircleX className="size-3.5 text-destructive" aria-label="Error" />,
};

/**
 * Find a site's sitemap, list its URLs with checkboxes and let the user pick
 * up to 200 pages to validate.
 */
export function SitemapPicker({ busy, onSubmit }: { busy: boolean; onSubmit: (urls: string[], sitemap: string) => void }) {
  const [options] = useOptions();
  const [input, setInput] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; data: SitemapDiscovery }>({
    kind: "idle",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const controller = useRef<AbortController | null>(null);
  const ids = { url: useId(), filter: useId() };

  const urls = useMemo(() => (state.kind === "done" ? state.data.urls : []), [state]);
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? urls.filter((u) => u.loc.toLowerCase().includes(needle)) : urls;
  }, [urls, filter]);

  const discover = async () => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setState({ kind: "loading" });
    try {
      const data = await discoverSitemapRequest(input.trim(), options, ac.signal);
      if (ac.signal.aborted) return;
      setState({ kind: "done", data });
      setSelected(new Set(data.urls.slice(0, MAX_BULK_URLS).map((u) => u.loc)));
      setFilter("");
      setLimit(PAGE);
    } catch (err) {
      if (!ac.signal.aborted) setState({ kind: "error", message: err instanceof Error ? err.message : "Discovery failed." });
    }
  };

  const toggle = (loc: string, on: boolean) => {
    const next = new Set(selected);
    if (on) {
      if (next.size >= MAX_BULK_URLS) return;
      next.add(loc);
    } else next.delete(loc);
    setSelected(next);
  };

  /** Select matching URLs (in list order) until the 200 limit is reached. */
  const selectMatching = () => {
    const next = new Set(selected);
    for (const u of filtered) {
      if (next.size >= MAX_BULK_URLS) break;
      next.add(u.loc);
    }
    setSelected(next);
  };
  const clearMatching = () => {
    const next = new Set(selected);
    for (const u of filtered) next.delete(u.loc);
    setSelected(next);
  };

  const full = selected.size >= MAX_BULK_URLS;

  return (
    <div className="space-y-4">
      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) void discover();
        }}
      >
        <Label htmlFor={ids.url}>Site or sitemap URL</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <MapIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id={ids.url}
              inputMode="url"
              spellCheck={false}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://example.com/ or https://example.com/sitemap.xml"
              className="h-9 pl-8"
              aria-describedby={`${ids.url}-hint`}
            />
          </div>
          <Button type="submit" variant="outline" size="lg" className="h-9" disabled={!input.trim() || state.kind === "loading"}>
            {state.kind === "loading" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
            {state.kind === "loading" ? "Finding pages…" : "Find pages"}
          </Button>
        </div>
        <p id={`${ids.url}-hint`} className="text-xs text-muted-foreground">
          For a site root, MarkupLens tries /sitemap.xml, /sitemap_index.xml, then the Sitemap: lines in robots.txt. Sitemap indexes and
          .xml.gz files are followed.
        </p>
      </form>

      {state.kind === "error" && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      {state.kind === "done" && (
        <div className="space-y-3" aria-live="polite">
          <ul className="space-y-1 text-xs" aria-label="Locations tried">
            {state.data.tried.map((t) => (
              <li key={t.url} className="flex items-center gap-1.5">
                {OUTCOME_ICON[t.outcome]}
                <span className="truncate font-mono">{t.url}</span>
                {t.detail && <span className="shrink-0 text-muted-foreground">· {t.detail}</span>}
              </li>
            ))}
          </ul>
          {state.data.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning-foreground">
              {state.data.warnings.slice(0, 5).map((w) => (
                <li key={w} className="break-all">
                  {w}
                </li>
              ))}
            </ul>
          )}

          {urls.length === 0 ? (
            <p className="rounded-md bg-muted/50 p-3 text-sm">
              No pages found. Check the address, or switch to <strong>URL list</strong> and paste the pages you want to check.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="grid flex-1 gap-1">
                  <Label htmlFor={ids.filter} className="text-xs">
                    Filter {urls.length.toLocaleString("en")} URLs{state.data.truncated ? " (list truncated)" : ""} from{" "}
                    {state.data.sitemaps.length} sitemap file{state.data.sitemaps.length === 1 ? "" : "s"}
                  </Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id={ids.filter}
                      type="search"
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setLimit(PAGE);
                      }}
                      placeholder="e.g. /blog/"
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button variant="outline" size="sm" onClick={selectMatching} disabled={full}>
                    Select {filter ? "matching" : "all"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={clearMatching} disabled={selected.size === 0}>
                    Clear {filter ? "matching" : "all"}
                  </Button>
                </div>
              </div>

              <p className={`text-sm ${full ? "font-medium text-warning-foreground" : "text-muted-foreground"}`}>
                {selected.size} of {MAX_BULK_URLS} selected{full ? " — the limit for one run" : ""}
                {filter ? ` · ${filtered.length.toLocaleString("en")} match the filter` : ""}
              </p>

              <ul className="max-h-96 divide-y overflow-auto rounded-lg border" aria-label="Pages found in the sitemap">
                {filtered.slice(0, limit).map((u) => {
                  const checked = selected.has(u.loc);
                  const id = `sm-${u.loc}`;
                  return (
                    <li key={u.loc} className="flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted/40">
                      <Checkbox id={id} checked={checked} disabled={!checked && full} onCheckedChange={(v) => toggle(u.loc, v === true)} />
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate font-mono text-[12.5px]" title={u.loc}>
                        {u.loc}
                      </label>
                      {u.lastmod && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{u.lastmod.slice(0, 10)}</span>}
                    </li>
                  );
                })}
              </ul>
              {filtered.length > limit && (
                <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
                  Showing {limit.toLocaleString("en")} of {filtered.length.toLocaleString("en")}
                  <Button variant="outline" size="sm" onClick={() => setLimit(limit + PAGE)}>
                    Show more
                  </Button>
                </div>
              )}

              <form
                className="flex justify-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  // Keep sitemap order for the run.
                  const chosen = urls.map((u) => u.loc).filter((loc) => selected.has(loc));
                  // The report names the sitemap that was read (or what the user typed).
                  if (chosen.length) onSubmit(chosen, state.data.sitemaps[0] ?? state.data.input);
                }}
              >
                <SubmitButton busy={busy} disabled={selected.size === 0} label={`Validate ${selected.size} page${selected.size === 1 ? "" : "s"}`} />
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
