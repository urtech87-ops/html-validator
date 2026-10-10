import "server-only";
import type { Prisma, Run } from "@/generated/prisma/client";
import { summarizeBulk, type BulkPage } from "@/lib/bulk/aggregate";
import type { BulkEvent } from "@/lib/bulk/types";
import { parseOptions, type ValidationOptions } from "@/lib/validation/options";
import type { DocumentResult, RunResult } from "@/lib/validation/types";
import { packJson, unpackJson } from "./codec";
import { getDb } from "./db";
import { compactIfNeeded, deleteRunsById, enforceRetention, exclusive, storedBytes } from "./retention";
import { singleTargetKey, siteKey } from "./target-key";
import {
  HISTORY_PAGE_SIZE,
  MAX_SAVED_SOURCE_BYTES,
  type HistoryPage,
  type HistoryQuery,
  type RerunInput,
  type RunInputType,
  type RunKind,
  type RunStatus,
  type RunSummaryRow,
  type SavedBulk,
  type SavedReportRow,
  type SavedRun,
  type SavedRunData,
} from "./types";

/**
 * Saving and reading history. Results and re-run input are stored as gzipped
 * JSON. Document sources are kept up to MAX_SAVED_SOURCE_BYTES per run (the
 * rest are marked sourceOmitted, as bulk runs already do above 300 KB).
 */

const sourceBytes = (doc: DocumentResult) => (doc.source ? Buffer.byteLength(doc.source, "utf8") : 0);

/** Keep document sources while they fit in the budget; returns the documents and what is left of it. */
export function capSources(documents: DocumentResult[], budget: number): { documents: DocumentResult[]; left: number } {
  let left = budget;
  const out = documents.map((d) => {
    const size = sourceBytes(d);
    if (size === 0) return d;
    if (size <= left) {
      left -= size;
      return d;
    }
    return { ...d, source: "", sourceOmitted: true };
  });
  return { documents: out, left };
}

/** Size of a re-run input once stored (uploads count their file bytes). */
export function rerunInputBytes(input: RerunInput): number {
  if (input.type === "upload") return input.files.reduce((n, f) => n + Math.ceil((f.base64.length * 3) / 4), 0);
  if (input.type === "bulk") return input.urls.reduce((n, u) => n + u.length, 0);
  return Buffer.byteLength(input.value, "utf8");
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);

type RunListRow = Omit<Run, "input" | "results" | "options"> & { _count: { reports: number } };

const LIST_SELECT = {
  id: true,
  createdAt: true,
  finishedAt: true,
  kind: true,
  inputType: true,
  target: true,
  targetKey: true,
  status: true,
  score: true,
  passed: true,
  errors: true,
  warnings: true,
  info: true,
  pageCount: true,
  pagesDone: true,
  durationMs: true,
  engineVersion: true,
  canRerun: true,
  sizeBytes: true,
  _count: { select: { reports: true } },
} satisfies Prisma.RunSelect;

function toSummary(r: RunListRow): RunSummaryRow {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    kind: r.kind as RunKind,
    inputType: r.inputType as RunInputType,
    target: r.target,
    targetKey: r.targetKey,
    status: r.status as RunStatus,
    score: r.score ?? undefined,
    passed: r.passed ?? undefined,
    counts: { errors: r.errors, warnings: r.warnings, info: r.info },
    pageCount: r.pageCount,
    pagesDone: r.pagesDone,
    durationMs: r.durationMs ?? undefined,
    engineVersion: r.engineVersion ?? undefined,
    sizeBytes: r.sizeBytes,
    reportCount: r._count.reports,
    canRerun: r.canRerun,
  };
}

/* ------------------------------------------------------------------ saving */

/** Save a finished single run (URL, upload or direct input). The history id is the run's id. */
export async function saveSingleRun(run: RunResult, options: ValidationOptions, rerun: RerunInput | null): Promise<string> {
  const db = await getDb();
  const saved: RunResult = { ...run, documents: capSources(run.documents, MAX_SAVED_SOURCE_BYTES).documents };
  const keepInput = rerun && rerunInputBytes(rerun) <= MAX_SAVED_SOURCE_BYTES ? rerun : null;
  const [results, input] = await Promise.all([packJson(saved), keepInput ? packJson(keepInput) : Promise.resolve(null)]);
  const fileNames = run.input.type === "upload" ? run.documents.map((d) => d.label) : [];
  await db.run.create({
    data: {
      id: run.id,
      createdAt: new Date(run.createdAt),
      finishedAt: new Date(run.createdAt),
      kind: "single",
      inputType: run.input.type,
      target: run.input.type === "upload" ? fileNames.join(", ") : run.input.target,
      targetKey: singleTargetKey(run.input.type, run.input.target, fileNames),
      status: "done",
      score: run.score,
      passed: run.passed,
      errors: run.counts.errors,
      warnings: run.counts.warnings,
      info: run.counts.info,
      pageCount: run.documents.length,
      pagesDone: run.documents.length,
      durationMs: run.durationMs,
      engineVersion: run.engineVersion,
      options: JSON.stringify(options),
      input,
      canRerun: !!input,
      results,
      sizeBytes: results.byteLength + (input?.byteLength ?? 0),
    },
  });
  await enforceRetention(run.id);
  return run.id;
}

/**
 * Records a bulk run as it goes: the row is created when the run starts and
 * rewritten (at most every `flushMs`) as pages finish, so a cancelled or
 * interrupted run keeps the pages it finished.
 */
export class BulkRecorder {
  readonly id: string;
  private pages: BulkPage[];
  private sourceBudget = MAX_SAVED_SOURCE_BYTES;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  private failed = false;
  private inputBytes = 0;

  private constructor(
    id: string,
    private readonly meta: Omit<SavedBulk, "pages" | "cancelled" | "durationMs">,
    urls: string[],
    private readonly flushMs: number,
  ) {
    this.id = id;
    this.pages = urls.map((url, index) => ({ index, url, status: "queued" }));
  }

  static async start(args: {
    id: string;
    urls: string[];
    options: ValidationOptions;
    concurrency: number;
    mode: "sitemap" | "url-list";
    target: string;
    flushMs?: number;
  }): Promise<BulkRecorder> {
    const db = await getDb();
    const startedAt = new Date();
    const recorder = new BulkRecorder(args.id, { mode: args.mode, target: args.target, concurrency: args.concurrency, startedAt: startedAt.toISOString() }, args.urls, args.flushMs ?? 2000);
    const rerun: RerunInput = { type: "bulk", mode: args.mode, target: args.target, urls: args.urls, concurrency: args.concurrency };
    const [input, results] = await Promise.all([packJson(rerun), packJson(recorder.snapshot(false))]);
    recorder.inputBytes = input.byteLength;
    await db.run.create({
      data: {
        id: args.id,
        createdAt: startedAt,
        kind: "bulk",
        inputType: args.mode,
        target: args.target,
        targetKey: siteKey(args.urls, args.mode === "sitemap" ? args.target : undefined),
        status: "running",
        pageCount: args.urls.length,
        options: JSON.stringify(args.options),
        input,
        canRerun: true,
        results,
        sizeBytes: input.byteLength + results.byteLength,
      },
    });
    return recorder;
  }

  private snapshot(cancelled: boolean, durationMs?: number): SavedBulk {
    return { ...this.meta, cancelled, durationMs, pages: this.pages };
  }

  /** Feed every BulkEvent of the run. */
  record(event: BulkEvent): void {
    if (event.type === "page-start") {
      this.pages[event.index] = { ...this.pages[event.index], status: "running" };
      return;
    }
    if (event.type === "page-done") {
      const capped = capSources(event.run.documents, this.sourceBudget);
      this.sourceBudget = capped.left;
      this.pages[event.index] = { ...this.pages[event.index], status: "done", run: { ...event.run, documents: capped.documents } };
    } else if (event.type === "page-error") {
      this.pages[event.index] = { ...this.pages[event.index], status: "error", error: event.error };
    } else {
      return;
    }
    if (!this.timer) this.timer = setTimeout(() => void this.flush("running"), this.flushMs);
  }

  private flush(status: RunStatus, durationMs?: number): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const pages = this.pages.slice();
    this.writing = this.writing.then(async () => {
      if (this.failed) return;
      try {
        const db = await getDb();
        const summary = summarizeBulk(pages, 0);
        const final = status !== "running";
        const results = await packJson({ ...this.snapshot(status === "cancelled", durationMs), pages });
        const validated = summary.passed + summary.failed;
        await db.run.update({
          where: { id: this.id },
          data: {
            status,
            finishedAt: final ? new Date() : undefined,
            durationMs: durationMs ?? undefined,
            score: summary.averageScore ?? null,
            passed: validated > 0 ? summary.failed === 0 : null,
            errors: summary.counts.errors,
            warnings: summary.counts.warnings,
            info: summary.counts.info,
            pagesDone: summary.byStatus.done + summary.byStatus.error,
            engineVersion: pages.find((p) => p.run?.engineVersion)?.run?.engineVersion ?? null,
            results,
            sizeBytes: results.byteLength + this.inputBytes,
          },
        });
      } catch (err) {
        this.failed = true;
        // P2025: the row is gone (deleted from history while the run was going).
        if ((err as { code?: string })?.code !== "P2025") console.error(`Saving bulk run ${this.id} to history failed:`, err);
      }
    });
    return this.writing;
  }

  /** Final write: pages that never ran are marked cancelled. */
  async finish(cancelled: boolean, durationMs: number): Promise<void> {
    if (cancelled) this.pages = this.pages.map((p) => (p.status === "queued" || p.status === "running" ? { ...p, status: "cancelled" } : p));
    await this.flush(cancelled ? "cancelled" : "done", durationMs);
    if (!this.failed) await enforceRetention(this.id).catch((err) => console.error("History retention failed:", err));
  }
}

/* ----------------------------------------------------------------- reading */

function whereFor(query: HistoryQuery): Prisma.RunWhereInput {
  const and: Prisma.RunWhereInput[] = [];
  if (query.search) and.push({ OR: [{ target: { contains: query.search } }, { id: { startsWith: query.search } }] });
  if (query.type === "url") and.push({ inputType: "url" });
  else if (query.type === "upload") and.push({ inputType: "upload" });
  else if (query.type === "direct") and.push({ inputType: { in: ["html", "css"] } });
  else if (query.type === "bulk") and.push({ kind: "bulk" });
  if (query.result === "passed") and.push({ passed: true, status: "done" });
  else if (query.result === "errors") and.push({ passed: false });
  else if (query.result === "incomplete") and.push({ status: { in: ["running", "cancelled", "interrupted"] } });
  return and.length ? { AND: and } : {};
}

function orderFor(sort: HistoryQuery["sort"]): Prisma.RunOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "score-asc":
      return [{ score: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
    case "score-desc":
      return [{ score: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    case "errors":
      return [{ errors: "desc" }, { createdAt: "desc" }];
    case "target":
      return [{ target: "asc" }, { createdAt: "desc" }];
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

export async function listRuns(query: HistoryQuery, pageSize = HISTORY_PAGE_SIZE): Promise<HistoryPage> {
  const db = await getDb();
  const where = whereFor(query);
  const [total, all, bytes] = await Promise.all([db.run.count({ where }), db.run.count(), storedBytes(db)]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pageCount);
  const rows = await db.run.findMany({ where, orderBy: orderFor(query.sort), skip: (page - 1) * pageSize, take: pageSize, select: LIST_SELECT });
  return { rows: rows.map(toSummary), total, page, pageCount, totals: { runs: all, bytes } };
}

export async function getRunSummary(id: string): Promise<RunSummaryRow | undefined> {
  const db = await getDb();
  const row = await db.run.findUnique({ where: { id }, select: LIST_SELECT });
  return row ? toSummary(row) : undefined;
}

function toReportRow(r: { id: string; runId: string; createdAt: Date; format: string; filename: string; sizeBytes: number }): SavedReportRow {
  return { id: r.id, runId: r.runId, createdAt: r.createdAt.toISOString(), format: r.format, filename: r.filename, sizeBytes: r.sizeBytes };
}

/** A saved run with its results and saved reports. */
export async function loadRun(id: string): Promise<SavedRun | undefined> {
  const db = await getDb();
  const row = await db.run.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      options: true,
      results: true,
      reports: { orderBy: { createdAt: "desc" }, select: { id: true, runId: true, createdAt: true, format: true, filename: true, sizeBytes: true } },
    },
  });
  if (!row) return undefined;
  const summary = toSummary(row);
  const options = parseOptions(safeJson(row.options));
  let data: SavedRunData;
  if (summary.kind === "bulk") {
    const bulk: SavedBulk = row.results
      ? await unpackJson<SavedBulk>(row.results)
      : { mode: summary.inputType === "sitemap" ? "sitemap" : "url-list", target: summary.target, concurrency: 3, startedAt: summary.createdAt, cancelled: true, pages: [] };
    // An interrupted run's pages that never finished read as cancelled.
    if (summary.status !== "running") bulk.pages = bulk.pages.map((p) => (p.status === "queued" || p.status === "running" ? { ...p, status: "cancelled" } : p));
    data = { kind: "bulk", bulk: summary.status === "done" ? bulk : { ...bulk, cancelled: true } };
  } else {
    if (!row.results) return undefined;
    data = { kind: "single", run: await unpackJson<RunResult>(row.results) };
  }
  return { summary, options, data, reports: row.reports.map(toReportRow) };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function loadRerunInput(id: string): Promise<{ input: RerunInput; options: ValidationOptions } | undefined> {
  const db = await getDb();
  const row = await db.run.findUnique({ where: { id }, select: { input: true, options: true } });
  if (!row?.input) return undefined;
  return { input: await unpackJson<RerunInput>(row.input), options: parseOptions(safeJson(row.options)) };
}

/** The latest earlier run of the same target and kind (for "compare with previous run"). */
export async function previousRunId(summary: RunSummaryRow): Promise<string | undefined> {
  const db = await getDb();
  const row = await db.run.findFirst({
    where: { targetKey: summary.targetKey, kind: summary.kind, id: { not: summary.id }, status: { not: "running" }, createdAt: { lte: new Date(summary.createdAt) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return row?.id;
}

/** Delete runs; runs still in progress are skipped. Compacts the database afterwards when worthwhile. */
export function deleteRuns(ids: string[]): Promise<string[]> {
  return exclusive(async () => {
    const db = await getDb();
    const deleted = await deleteRunsById(db, ids);
    if (deleted.length > 0) await compactIfNeeded(db);
    return deleted;
  });
}

export async function listReports(runId: string): Promise<SavedReportRow[]> {
  const db = await getDb();
  const rows = await db.report.findMany({ where: { runId }, orderBy: { createdAt: "desc" } });
  return rows.map(toReportRow);
}

/** Save a single run for an API response: never throws, so a history problem can't fail a validation. */
export async function trySaveSingleRun(run: RunResult, options: ValidationOptions, rerun: RerunInput | null): Promise<{ runId?: string; saveError?: string }> {
  try {
    return { runId: await saveSingleRun(run, options, rerun) };
  } catch (err) {
    console.error("Saving the run to history failed:", err);
    return { saveError: "The run could not be saved to history (see the server log)." };
  }
}

/** API flag: saving is on unless the request says `save: false`. */
export function wantsSave(value: unknown): boolean {
  return !(value === false || value === "false" || value === "0");
}
