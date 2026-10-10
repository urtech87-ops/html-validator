import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedReport } from "@/lib/report/generate";
import { FORMAT_META, type ReportBranding, type ReportContents, type ReportFormat, type ReportSource } from "@/lib/report/types";
import { getDb, reportsDir } from "./db";
import { enforceRetention, exclusive, removeReportFile, trimRunReports } from "./retention";
import { MAX_SAVED_REPORT_BYTES, type SavedRun } from "./types";

/** Saved report files: DATA_DIR/reports/<runId>/<reportId>.<ext>, one Report row each. */

/** The report source for a saved run (what POST /api/report with a runId renders). */
export function reportSourceFor(saved: SavedRun): ReportSource {
  if (saved.data.kind === "single") return { kind: "single", run: saved.data.run };
  const b = saved.data.bulk;
  return { kind: "bulk", target: b.target, mode: b.mode, pages: b.pages, startedAt: b.startedAt, cancelled: b.cancelled };
}

export type SaveReportResult = { saved: true; id: string } | { saved: false; reason: string };

export async function saveReport(
  runId: string,
  report: GeneratedReport,
  request: { format: ReportFormat; contents: ReportContents; branding: ReportBranding },
): Promise<SaveReportResult> {
  const body = typeof report.body === "string" ? Buffer.from(report.body, "utf8") : report.body;
  if (body.byteLength > MAX_SAVED_REPORT_BYTES) {
    return { saved: false, reason: `The report is larger than ${MAX_SAVED_REPORT_BYTES / 1024 / 1024} MB, so it was downloaded but not saved to history.` };
  }
  const db = await getDb();
  const id = randomUUID();
  const file = `${path.basename(runId)}/${id}.${FORMAT_META[request.format].extension}`;
  const full = path.join(/* turbopackIgnore: true */ reportsDir(), file);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  const { logo, ...branding } = request.branding;
  try {
    await db.report.create({
      data: {
        id,
        runId,
        format: request.format,
        filename: report.filename,
        contentType: report.contentType,
        sizeBytes: body.byteLength,
        file,
        contents: JSON.stringify(request.contents),
        branding: JSON.stringify({ ...branding, logo: logo ? true : undefined }),
      },
    });
  } catch (err) {
    await removeReportFile(file);
    throw err;
  }
  await exclusive(async () => trimRunReports(db, runId));
  await enforceRetention(runId);
  return { saved: true, id };
}

export interface SavedReportFile {
  id: string;
  runId: string;
  filename: string;
  contentType: string;
  body: Buffer;
}

export async function readSavedReport(id: string): Promise<SavedReportFile | undefined> {
  const db = await getDb();
  const row = await db.report.findUnique({ where: { id } });
  if (!row) return undefined;
  const root = reportsDir();
  const full = path.resolve(/* turbopackIgnore: true */ root, row.file);
  if (!full.startsWith(root + path.sep)) return undefined;
  try {
    return { id: row.id, runId: row.runId, filename: row.filename, contentType: row.contentType, body: await readFile(full) };
  } catch {
    return undefined; // file removed outside the app
  }
}

export async function deleteSavedReport(id: string): Promise<boolean> {
  const db = await getDb();
  return exclusive(async () => {
    const row = await db.report.findUnique({ where: { id }, select: { file: true } });
    if (!row) return false;
    await db.report.delete({ where: { id } });
    await removeReportFile(row.file);
    return true;
  });
}
