"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useMessageFilters } from "@/components/validate/settings-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compileFilters, escapeRegex } from "@/lib/validation/message-filters";
import type { ValidationOptions } from "@/lib/validation/options";
import { filterMessages, groupMessages, sortMessages, type MessageQuery, type SortOrder } from "@/lib/validation/view";
import type { DocumentResult, MessageCategory, RunResult, Severity } from "@/lib/validation/types";
import { DocumentDetails } from "./document-details";
import { ImageReport } from "./image-report";
import { MessageList } from "./message-list";
import { OutlineView } from "./outline-view";
import { CountPills, PassBadge, RunSummary } from "./run-summary";
import { SEVERITY_META } from "./severity";
import { SourceView } from "./source-view";
import { StructureView } from "./structure-view";

const DEFAULT_QUERY: MessageQuery = { severities: { error: true, warning: true, info: true }, category: "all", search: "" };

export function ResultsView({ run, options }: { run: RunResult; options: ValidationOptions }) {
  const [docId, setDocId] = useState(run.documents[0]?.id);
  const doc = run.documents.find((d) => d.id === docId) ?? run.documents[0];
  const multi = run.documents.length > 1;

  const headingTitle =
    run.input.type === "url" ? run.input.target : run.input.type === "upload" ? `${run.documents.length} uploaded file(s)` : "Direct input";

  return (
    <section aria-labelledby="results-heading" className="space-y-4">
      <Card>
        <CardContent>
          <RunSummary
            title={headingTitle}
            score={run.score}
            passed={run.passed}
            counts={run.counts}
            documents={run.documents.length}
            durationMs={run.durationMs}
            engineVersion={run.engineVersion}
          />
        </CardContent>
      </Card>

      <div className={multi ? "grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]" : ""}>
        {multi && <DocumentPicker documents={run.documents} activeId={doc.id} onSelect={setDocId} />}
        {doc && <DocumentPanel key={`${run.id}:${doc.id}`} doc={doc} options={options} showTitle={multi} />}
      </div>
    </section>
  );
}

function DocumentPicker({
  documents,
  activeId,
  onSelect,
}: {
  documents: DocumentResult[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Validated documents" className="lg:sticky lg:top-18 lg:self-start">
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[calc(100vh-6rem)] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto">
        {documents.map((d) => {
          const active = d.id === activeId;
          const name = d.origin === "stylesheet" ? (d.url?.split("/").pop() || d.label) : d.label;
          return (
            <li key={d.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                onClick={() => onSelect(d.id)}
                aria-current={active ? "true" : undefined}
                className={`flex w-56 flex-col gap-1 rounded-lg border p-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:w-full ${
                  active ? "border-primary bg-primary/8" : "hover:bg-muted/50"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-muted px-1 font-mono text-[10px] font-semibold uppercase">{d.kind}</span>
                  <span className="min-w-0 flex-1 truncate font-medium" title={d.label}>
                    {name}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  <span className={d.counts.errors ? SEVERITY_META.error.text : ""}>{d.counts.errors} E</span>
                  <span className={d.counts.warnings ? SEVERITY_META.warning.text : ""}>{d.counts.warnings} W</span>
                  <span>{d.counts.info} I</span>
                  <span className="ml-auto">{d.fatal ? "Not validated" : `Score ${d.score}`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function DocumentPanel({ doc, options, showTitle }: { doc: DocumentResult; options: ValidationOptions; showTitle: boolean }) {
  const [filters, setFilters] = useMessageFilters();
  const [query, setQuery] = useState<MessageQuery>(DEFAULT_QUERY);
  const [order, setOrder] = useState<SortOrder>("line");
  const [grouped, setGrouped] = useState(options.grouping === "by-type");
  const [showHidden, setShowHidden] = useState(false);
  const [tab, setTab] = useState("messages");
  const [reveal, setReveal] = useState<{ line: number; nonce: number }>();
  const [highlightedId, setHighlightedId] = useState<string>();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const pendingScroll = useRef<string | null>(null);
  const ids = { search: useId(), category: useId(), sort: useId(), group: useId(), hidden: useId() };

  const isHidden = useMemo(() => compileFilters(filters), [filters]);
  const { visible, hiddenByUser } = useMemo(
    () => filterMessages(doc.messages, query, showHidden ? () => false : isHidden),
    [doc.messages, query, isHidden, showHidden],
  );
  const severityCounts = useMemo(() => {
    const c: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const m of doc.messages) c[m.severity]++;
    return c;
  }, [doc.messages]);
  const hasCss = doc.messages.some((m) => m.category === "css");
  const canShowSource = options.showSource && !doc.fatal && doc.source.length > 0;
  const structure = doc.fatal ? undefined : doc.structure;

  const jumpToSource = useCallback((line: number) => {
    setTab("source");
    setReveal({ line, nonce: Date.now() });
  }, []);

  /** Gutter click: show the first visible message on that line in the message list. */
  const showMessagesForLine = useCallback(
    (line: number) => {
      const onLine = sortMessages(visible, order).filter((m) => (m.firstLine ?? m.lastLine) === line || m.lastLine === line);
      const target = onLine[0];
      if (!target) return;
      if (grouped) {
        const group = groupMessages(visible, order).find((g) => g.items.some((m) => m.id === target.id));
        if (group) setOpenGroups((prev) => new Set(prev).add(group.key));
      }
      setHighlightedId(target.id);
      pendingScroll.current = target.id;
      setTab("messages");
    },
    [visible, order, grouped],
  );

  // Scroll to the highlighted message once the Messages tab has rendered it.
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id || tab !== "messages") return;
    pendingScroll.current = null;
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${id}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    });
  }, [tab, highlightedId, openGroups]);

  const hideLike = useCallback(
    (text: string) => setFilters([...filters, { id: crypto.randomUUID(), pattern: `^${escapeRegex(text)}$`, isRegex: true }]),
    [filters, setFilters],
  );

  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4">
        {showTitle && (
          <div className="flex flex-wrap items-center gap-2">
            <PassBadge passed={doc.passed} />
            <h3 className="min-w-0 flex-1 truncate font-heading font-semibold" title={doc.label}>
              {doc.url ? (
                <a href={doc.url} target="_blank" rel="noreferrer noopener" className="underline-offset-4 hover:underline">
                  {doc.label}
                </a>
              ) : (
                doc.label
              )}
            </h3>
            <span className="text-sm text-muted-foreground tabular-nums">Score {doc.score}</span>
          </div>
        )}
        {showTitle && <CountPills counts={doc.counts} />}
        <DocumentDetails doc={doc} />

        <Tabs value={tab} onValueChange={setTab}>
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList>
              <TabsTrigger value="messages">Messages ({doc.messages.length.toLocaleString("en")})</TabsTrigger>
              {structure && (
                <TabsTrigger value="structure">
                  Structure
                  {structure.counts.fail > 0 && (
                    <span className="rounded-full bg-destructive/15 px-1.5 text-[11px] font-semibold text-destructive tabular-nums" aria-label={`${structure.counts.fail} failed`}>
                      {structure.counts.fail}
                    </span>
                  )}
                </TabsTrigger>
              )}
              {structure && options.showOutline && <TabsTrigger value="outline">Outline ({structure.outline.length})</TabsTrigger>}
              {structure && options.imageReport && <TabsTrigger value="images">Images ({structure.images.length})</TabsTrigger>}
              {canShowSource && <TabsTrigger value="source">Source</TabsTrigger>}
            </TabsList>
          </div>

          <TabsContent value="messages" className="space-y-3 pt-2">
            {doc.messages.length > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" role="group" aria-label="Filter and sort messages">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Severity">
                  {(["error", "warning", "info"] as const).map((s) => {
                    const meta = SEVERITY_META[s];
                    const on = query.severities[s];
                    return (
                      <Button
                        key={s}
                        variant="outline"
                        size="sm"
                        aria-pressed={on}
                        onClick={() => setQuery({ ...query, severities: { ...query.severities, [s]: !on } })}
                        className={on ? `${meta.soft} border-current/30` : "opacity-60"}
                      >
                        <meta.Icon className={meta.text} aria-hidden="true" />
                        {meta.plural} <span className="tabular-nums">{severityCounts[s]}</span>
                      </Button>
                    );
                  })}
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                  <div className="grid gap-1">
                    <Label htmlFor={ids.search} className="text-xs">
                      Search
                    </Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id={ids.search}
                        type="search"
                        value={query.search}
                        onChange={(e) => setQuery({ ...query, search: e.target.value })}
                        placeholder="Message or code…"
                        className="pl-8"
                      />
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={ids.category} className="text-xs">
                      Type
                    </Label>
                    <Select value={query.category} onValueChange={(v) => setQuery({ ...query, category: v as MessageCategory | "all" })}>
                      <SelectTrigger id={ids.category} className="w-full sm:w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        <SelectItem value="html">{doc.kind === "css" ? "Markup" : "HTML"}</SelectItem>
                        <SelectItem value="css" disabled={!hasCss && doc.kind !== "css"}>
                          CSS
                        </SelectItem>
                        <SelectItem value="document">Document</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={ids.sort} className="text-xs">
                      Sort by
                    </Label>
                    <Select value={order} onValueChange={(v) => setOrder(v as SortOrder)}>
                      <SelectTrigger id={ids.sort} className="w-full sm:w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="line">Line</SelectItem>
                        <SelectItem value="severity">Severity</SelectItem>
                        <SelectItem value="frequency">Frequency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <Switch id={ids.group} checked={grouped} onCheckedChange={setGrouped} />
                    <Label htmlFor={ids.group} className="font-normal">
                      Group identical messages
                    </Label>
                  </div>
                  {(hiddenByUser > 0 || showHidden) && (
                    <div className="flex items-center gap-2">
                      <Switch id={ids.hidden} checked={showHidden} onCheckedChange={setShowHidden} />
                      <Label htmlFor={ids.hidden} className="font-normal">
                        Show messages hidden by your filters{!showHidden && ` (${hiddenByUser})`}
                      </Label>
                    </div>
                  )}
                </div>
              </div>
            )}

            <p className="text-sm text-muted-foreground" aria-live="polite">
              {doc.messages.length === 0
                ? doc.fatal
                  ? "No validation results."
                  : "No problems found. 🎉"
                : `Showing ${visible.length.toLocaleString("en")} of ${doc.messages.length.toLocaleString("en")} messages${
                    hiddenByUser ? ` · ${hiddenByUser} hidden by your filters` : ""
                  }.`}
            </p>

            <MessageList
              messages={visible}
              order={order}
              grouped={grouped}
              highlightedId={highlightedId}
              openGroups={openGroups}
              onToggleGroup={(key, open) =>
                setOpenGroups((prev) => {
                  const next = new Set(prev);
                  if (open) next.add(key);
                  else next.delete(key);
                  return next;
                })
              }
              onJumpToSource={canShowSource ? jumpToSource : undefined}
              onHide={hideLike}
            />
          </TabsContent>

          {structure && (
            <TabsContent value="structure" className="pt-2">
              <StructureView report={structure} onJumpToSource={canShowSource ? jumpToSource : undefined} />
            </TabsContent>
          )}
          {structure && options.showOutline && (
            <TabsContent value="outline" className="pt-2">
              <OutlineView outline={structure.outline} fragment={structure.scope === "fragment"} onJumpToSource={canShowSource ? jumpToSource : undefined} />
            </TabsContent>
          )}
          {structure && options.imageReport && (
            <TabsContent value="images" className="pt-2">
              <ImageReport images={structure.images} onJumpToSource={canShowSource ? jumpToSource : undefined} />
            </TabsContent>
          )}

          {canShowSource && (
            <TabsContent value="source" className="pt-2">
              <p className="mb-2 text-xs text-muted-foreground">
                Lines with messages are marked in the gutter. Click a marker to see its messages.
              </p>
              <SourceView source={doc.source} kind={doc.kind} messages={visible} reveal={reveal} onLineClick={showMessagesForLine} />
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
