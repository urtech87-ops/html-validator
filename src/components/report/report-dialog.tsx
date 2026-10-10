"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck, FileDown, ImageUp, Loader2, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { createPersistedStore } from "@/lib/client/persisted-store";
import { downloadReport } from "@/lib/client/report-client";
import { checkLogoBytes } from "@/lib/report/logo";
import {
  CONTENT_KEYS,
  FORMAT_META,
  LOGO_MAX_BYTES,
  MAX_GROUPS_PER_DOCUMENT,
  REPORT_FORMATS,
  defaultContents,
  type ReportContents,
  type ReportFormat,
  type ReportSource,
} from "@/lib/report/types";

/** Format and branding text are remembered between reports (the logo is not). */
interface ReportPrefs {
  format: ReportFormat;
  project: string;
  preparedBy: string;
}

const DEFAULT_PREFS: ReportPrefs = { format: "pdf", project: "", preparedBy: "" };

/** Shared with the comparison export (project / prepared by). */
export const prefsStore = createPersistedStore<ReportPrefs>("markuplens-report-prefs", DEFAULT_PREFS, (raw) => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    format: REPORT_FORMATS.find((f) => f === o.format) ?? DEFAULT_PREFS.format,
    project: typeof o.project === "string" ? o.project.slice(0, 120) : "",
    preparedBy: typeof o.preparedBy === "string" ? o.preparedBy.slice(0, 120) : "",
  };
});

const CONTENT_LABEL: Record<keyof ReportContents, string> = {
  summary: "Executive summary",
  errors: "Errors",
  warnings: "Warnings",
  info: "Info messages",
  extracts: "Source extracts",
  structure: "Structure analysis",
  outline: "Heading outline",
  images: "Image report",
};

/** Toggles that don't change a format's output are disabled for it. */
const NOT_APPLICABLE: Partial<Record<ReportFormat, Array<keyof ReportContents>>> = {
  xlsx: ["summary", "outline", "images"],
  csv: ["summary", "structure", "outline", "images"],
};

const FORMAT_HINT: Record<ReportFormat, string> = {
  pdf: `A4, print-ready: cover, executive summary, page details, structure appendix. Up to ${MAX_GROUPS_PER_DOCUMENT} grouped messages per document.`,
  xlsx: "Five sheets: Report Info, Summary, Issues (with Issue ID, Status and Notes), Structure, Issue Types.",
  html: `One self-contained file, same layout as the PDF. Up to ${MAX_GROUPS_PER_DOCUMENT} grouped messages per document.`,
  json: "Machine-readable: everything selected, every message.",
  csv: "Issues only, one row per message. UTF-8, opens in Excel.",
};

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ReportDialog({
  source,
  runId,
  onSaved,
  verbose,
  disabled,
  label = "Generate report",
}: {
  /** Called when the user generates, so the latest run state is used. Ignored when `runId` is set. */
  source?: () => ReportSource;
  /** History id of the run: the server renders it from history and saves the report there. */
  runId?: string;
  /** Called after a report was saved to history. */
  onSaved?: (reportId: string) => void;
  /** Info messages are included by default only when the run was verbose. */
  verbose: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, prefsStore.getServerSnapshot);
  const [open, setOpen] = useState(false);
  const [contents, setContents] = useState<ReportContents>(() => defaultContents(verbose));
  const [reportDate, setReportDate] = useState("");
  const [logo, setLogo] = useState<{ dataUrl: string; name: string }>();
  const [logoError, setLogoError] = useState<string>();
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "done"; name: string; saved: boolean; notSaved?: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { project: useId(), preparedBy: useId(), date: useId(), logo: useId(), logoHint: useId() };

  useEffect(() => () => controller.current?.abort(), []);

  const format = prefs.format;
  const notApplicable = new Set(NOT_APPLICABLE[format] ?? []);
  const anySeverity = contents.errors || contents.warnings || contents.info;
  const busy = status.kind === "busy";

  const onOpenChange = (next: boolean) => {
    if (next) {
      setReportDate((d) => d || todayLocal());
      setStatus({ kind: "idle" });
    } else {
      controller.current?.abort();
    }
    setOpen(next);
  };

  const pickLogo = async (file: File | undefined) => {
    setLogoError(undefined);
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError("The logo is larger than 1 MB.");
      return;
    }
    const check = checkLogoBytes(new Uint8Array(await file.arrayBuffer()));
    if (!check.ok) {
      setLogoError(check.error);
      return;
    }
    setLogo({ dataUrl: check.dataUrl, name: file.name });
  };

  const clearLogo = () => {
    setLogo(undefined);
    setLogoError(undefined);
    if (fileInput.current) fileInput.current.value = "";
  };

  const generate = async () => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setStatus({ kind: "busy" });
    try {
      const options = {
        format,
        contents,
        branding: { project: prefs.project.trim(), preparedBy: prefs.preparedBy.trim(), reportDate: reportDate || todayLocal(), logo: logo?.dataUrl },
      };
      if (!runId && !source) throw new Error("Nothing to report on.");
      const result = await downloadReport(runId ? { ...options, runId } : { ...options, source: source!() }, ac.signal);
      if (ac.signal.aborted) return;
      setStatus({ kind: "done", name: result.name, saved: !!result.reportId, notSaved: result.notSaved });
      if (result.reportId) onSaved?.(result.reportId);
    } catch (err) {
      if (!ac.signal.aborted) setStatus({ kind: "error", message: err instanceof Error ? err.message : "The report could not be generated." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <FileDown aria-hidden="true" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate report</DialogTitle>
          <DialogDescription>
            {runId
              ? "The report is built from the saved run, downloaded, and kept in history so you can download it again."
              : "Reports are built from these results on demand and downloaded to your computer."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void generate();
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Format</legend>
            <RadioGroup
              value={format}
              onValueChange={(v) => prefsStore.set({ ...prefs, format: v as ReportFormat })}
              className="grid grid-cols-2 gap-2 sm:grid-cols-5"
            >
              {REPORT_FORMATS.map((f) => (
                <Label
                  key={f}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm font-normal transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 ${
                    f === format ? "border-primary bg-primary/8" : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value={f} />
                  {FORMAT_META[f].label}
                </Label>
              ))}
            </RadioGroup>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {FORMAT_HINT[format]}
            </p>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Contents</legend>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              {CONTENT_KEYS.map((key) => {
                const na = notApplicable.has(key);
                return (
                  <Label key={key} className={`flex items-center gap-2 font-normal ${na ? "text-muted-foreground" : ""}`}>
                    <Checkbox
                      checked={contents[key] && !na}
                      disabled={na}
                      onCheckedChange={(v) => setContents({ ...contents, [key]: v === true })}
                    />
                    {CONTENT_LABEL[key]}
                    {na && <span className="text-xs">(not in {FORMAT_META[format].label.split(" ")[0]})</span>}
                  </Label>
                );
              })}
            </div>
            {!verbose && !contents.info && (
              <p className="text-xs text-muted-foreground">Info messages are off because the run wasn&apos;t verbose. Turn them on to include any the run kept.</p>
            )}
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Branding</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={ids.project}>Client / project</Label>
                <Input
                  id={ids.project}
                  dir="auto"
                  maxLength={120}
                  value={prefs.project}
                  onChange={(e) => prefsStore.set({ ...prefs, project: e.target.value })}
                  placeholder="e.g. Acme website"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={ids.preparedBy}>Prepared by</Label>
                <Input
                  id={ids.preparedBy}
                  dir="auto"
                  maxLength={120}
                  value={prefs.preparedBy}
                  onChange={(e) => prefsStore.set({ ...prefs, preparedBy: e.target.value })}
                  placeholder="Your name or team"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={ids.date}>Report date</Label>
                <Input id={ids.date} type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={ids.logo}>Logo</Label>
                {logo ? (
                  <div className="flex items-center gap-2 rounded-md border p-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data: URL preview */}
                    <img src={logo.dataUrl} alt="" className="h-8 max-w-24 rounded-sm bg-white object-contain" />
                    <span className="min-w-0 flex-1 truncate text-sm" title={logo.name}>
                      {logo.name}
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={clearLogo}>
                      <Trash2 aria-hidden="true" /> Remove
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <ImageUp className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id={ids.logo}
                      ref={fileInput}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                      aria-describedby={ids.logoHint}
                      aria-invalid={logoError ? true : undefined}
                      className="pl-8"
                      onChange={(e) => void pickLogo(e.target.files?.[0])}
                    />
                  </div>
                )}
                <p id={ids.logoHint} className={`text-xs ${logoError ? "text-destructive" : "text-muted-foreground"}`}>
                  {logoError ?? "PNG, JPEG or WebP, up to 1 MB."}
                </p>
              </div>
            </div>
          </fieldset>

          <div aria-live="polite">
            {status.kind === "error" && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{status.message}</AlertDescription>
              </Alert>
            )}
            {status.kind === "done" && (
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-1.5 text-success">
                  <CircleCheck className="size-4" aria-hidden="true" /> Downloaded <span className="font-mono text-xs">{status.name}</span>
                  {status.saved && <span className="text-muted-foreground">· saved to history</span>}
                </p>
                {status.notSaved && <p className="text-xs text-muted-foreground">{status.notSaved}</p>}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {status.kind === "done" ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" disabled={busy || (!anySeverity && format === "csv")}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileDown aria-hidden="true" />}
              {busy ? "Generating…" : `Download ${FORMAT_META[format].label.split(" ")[0]}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
