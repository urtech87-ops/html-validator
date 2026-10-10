import "server-only";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { getDb, reportsDir } from "./db";
import { MAX_REPORTS_PER_RUN } from "./types";

/**
 * History retention: at most HISTORY_MAX_RUNS runs and HISTORY_MAX_MB of stored
 * data (database blobs + saved report files), oldest runs deleted first; at
 * most MAX_REPORTS_PER_RUN saved reports per run, oldest first. Runs still
 * in progress are never deleted. After deletions the database is compacted
 * (VACUUM) once enough space is free.
 */

const MIB = 1024 * 1024;
/** Compact when free pages make up this share of the file… */
const COMPACT_FREE_RATIO = 0.25;
/** …or at least this many bytes. */
const COMPACT_FREE_BYTES = 64 * MIB;

let chain: Promise<unknown> = Promise.resolve();

/** Run retention work one at a time (saves can finish concurrently). */
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/** Delete the report folders of these runs. */
export async function removeReportFiles(runIds: string[], dataDir = getConfig().dataDir): Promise<void> {
  const root = reportsDir(dataDir);
  await Promise.all(runIds.map((id) => rm(path.join(/* turbopackIgnore: true */ root, path.basename(id)), { recursive: true, force: true })));
}

export async function removeReportFile(file: string, dataDir = getConfig().dataDir): Promise<void> {
  const root = reportsDir(dataDir);
  const full = path.resolve(/* turbopackIgnore: true */ root, file);
  if (!full.startsWith(root + path.sep)) return;
  await rm(full, { force: true });
}

/** Delete runs (and their reports) by id, skipping runs in progress. Returns the ids deleted. */
export async function deleteRunsById(db: PrismaClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const deletable = await db.run.findMany({ where: { id: { in: ids }, status: { not: "running" } }, select: { id: true } });
  const toDelete = deletable.map((r) => r.id);
  if (toDelete.length === 0) return [];
  await db.$transaction([db.report.deleteMany({ where: { runId: { in: toDelete } } }), db.run.deleteMany({ where: { id: { in: toDelete } } })]);
  await removeReportFiles(toDelete);
  return toDelete;
}

/** Keep the newest MAX_REPORTS_PER_RUN reports of a run. */
export async function trimRunReports(db: PrismaClient, runId: string, max = MAX_REPORTS_PER_RUN): Promise<number> {
  const old = await db.report.findMany({ where: { runId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: max, select: { id: true, file: true } });
  if (old.length === 0) return 0;
  await db.report.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  await Promise.all(old.map((r) => removeReportFile(r.file)));
  return old.length;
}

export async function storedBytes(db: PrismaClient): Promise<number> {
  const [runs, reports] = await Promise.all([db.run.aggregate({ _sum: { sizeBytes: true } }), db.report.aggregate({ _sum: { sizeBytes: true } })]);
  return (runs._sum.sizeBytes ?? 0) + (reports._sum.sizeBytes ?? 0);
}

async function pragmaNumber(db: PrismaClient, name: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`PRAGMA ${name}`);
  const value = rows[0] ? Object.values(rows[0])[0] : 0;
  return Number(value ?? 0);
}

/** VACUUM when enough of the file is free pages; then truncate the WAL. Returns true if it compacted. */
export async function compactIfNeeded(db: PrismaClient, force = false): Promise<boolean> {
  const [pageSize, pageCount, freePages] = await Promise.all([
    pragmaNumber(db, "page_size"),
    pragmaNumber(db, "page_count"),
    pragmaNumber(db, "freelist_count"),
  ]);
  const freeBytes = freePages * pageSize;
  if (!force && (freePages === 0 || (freePages / Math.max(1, pageCount) < COMPACT_FREE_RATIO && freeBytes < COMPACT_FREE_BYTES))) return false;
  await db.$executeRawUnsafe("VACUUM");
  await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  return true;
}

export interface RetentionResult {
  deletedRuns: string[];
  compacted: boolean;
}

/** Apply the run-count and size limits. `keep` is never deleted (the run just saved). */
export function enforceRetention(keep?: string, limits = getConfig()): Promise<RetentionResult> {
  return exclusive(async () => {
    const db = await getDb();
    const deleted: string[] = [];
    const notKept = { status: { not: "running" }, ...(keep ? { id: { not: keep } } : {}) };

    const total = await db.run.count();
    if (total > limits.historyMaxRuns) {
      const oldest = await db.run.findMany({ where: notKept, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: total - limits.historyMaxRuns, select: { id: true } });
      deleted.push(...(await deleteRunsById(db, oldest.map((r) => r.id))));
    }

    const maxBytes = limits.historyMaxMb * MIB;
    let bytes = await storedBytes(db);
    while (bytes > maxBytes) {
      const batch = await db.run.findMany({
        where: { ...notKept, id: { notIn: keep ? [keep, ...deleted] : deleted } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 20,
        select: { id: true, sizeBytes: true, reports: { select: { sizeBytes: true } } },
      });
      if (batch.length === 0) break;
      const chosen: string[] = [];
      for (const run of batch) {
        chosen.push(run.id);
        bytes -= run.sizeBytes + run.reports.reduce((n, r) => n + r.sizeBytes, 0);
        if (bytes <= maxBytes) break;
      }
      const removed = await deleteRunsById(db, chosen);
      if (removed.length === 0) break;
      deleted.push(...removed);
      bytes = await storedBytes(db);
    }

    const compacted = deleted.length > 0 ? await compactIfNeeded(db) : false;
    return { deletedRuns: deleted, compacted };
  });
}
