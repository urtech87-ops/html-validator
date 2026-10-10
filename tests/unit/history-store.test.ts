import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getRun, DELETE as deleteRun } from "@/app/api/history/[id]/route";
import { GET as getCompare, POST as postCompare } from "@/app/api/history/compare/route";
import { GET as getReport, DELETE as deleteReport } from "@/app/api/history/reports/[id]/route";
import { DELETE as deleteMany, GET as listHistory } from "@/app/api/history/route";
import { POST as postReport } from "@/app/api/report/route";
import type { BulkEvent } from "@/lib/bulk/types";
import { getDb } from "@/lib/history/db";
import { compactIfNeeded, enforceRetention } from "@/lib/history/retention";
import { saveReport } from "@/lib/history/reports";
import { BulkRecorder, capSources, listRuns, loadRun, previousRunId, saveSingleRun } from "@/lib/history/store";
import { MAX_REPORTS_PER_RUN, MAX_SAVED_REPORT_BYTES, parseHistoryQuery, type HistoryPage, type SavedRun } from "@/lib/history/types";
import { DEFAULT_OPTIONS } from "@/lib/validation/options";
import type { RunResult } from "@/lib/validation/types";
import { doc, msg } from "../helpers/report-fixtures";
import { ctx, localRequest, useTempDataDir, type TempDataDir } from "../helpers/temp-db";

let tmp: TempDataDir;

beforeEach(async () => {
  tmp = await useTempDataDir("store", { HISTORY_MAX_RUNS: "500", HISTORY_MAX_MB: "2048" });
});
afterEach(async () => {
  await tmp.cleanup();
});

let clock = Date.parse("2026-10-01T00:00:00.000Z");
function singleRun(over: { target?: string; source?: string; errors?: number; type?: RunResult["input"]["type"] } = {}): RunResult {
  clock += 60_000;
  const target = over.target ?? "https://example.com/";
  const messages = Array.from({ length: over.errors ?? 1 }, (_, i) => msg({ severity: "error" as const, message: `Problem ${i}`, extract: `<p>${i}</p>` }));
  const page = doc({ id: "page", label: target, url: target, messages, source: over.source ?? "<p>hello</p>" });
  return {
    id: randomUUID(),
    createdAt: new Date(clock).toISOString(),
    input: { type: over.type ?? "url", target },
    documents: [page],
    counts: page.counts,
    score: page.score,
    passed: page.passed,
    engineVersion: "26.10.7",
    durationMs: 120,
  };
}

const json = async <T>(res: Response) => (await res.json()) as T;

describe("saving single runs", () => {
  it("saves results, options and re-run input, and reads them back", async () => {
    const r = singleRun({ errors: 2 });
    const id = await saveSingleRun(r, { ...DEFAULT_OPTIONS, verbose: true }, { type: "url", value: r.input.target });
    expect(id).toBe(r.id);
    const saved = (await loadRun(id))!;
    expect(saved.summary).toMatchObject({ kind: "single", inputType: "url", status: "done", score: 90, passed: false, canRerun: true, reportCount: 0 });
    expect(saved.summary.counts.errors).toBe(2);
    expect(saved.options.verbose).toBe(true);
    expect(saved.data.kind === "single" && saved.data.run.documents[0].source).toBe("<p>hello</p>");
    expect(saved.summary.sizeBytes).toBeGreaterThan(0);
  });

  it("caps saved document sources at 10 MB per run", () => {
    const big = "x".repeat(6 * 1024 * 1024);
    const docs = [doc({ label: "a", source: big }), doc({ label: "b", source: big }), doc({ label: "c", source: "small" })];
    const { documents } = capSources(docs, 10 * 1024 * 1024);
    expect(documents.map((d) => [d.source.length > 0, !!d.sourceOmitted])).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
  });

  it("doesn't keep a re-run input over 10 MB", async () => {
    const r = singleRun({ type: "upload" });
    const base64 = Buffer.alloc(11 * 1024 * 1024).toString("base64");
    await saveSingleRun(r, DEFAULT_OPTIONS, { type: "upload", files: [{ name: "big.html", kind: "html", base64 }] });
    expect((await loadRun(r.id))!.summary.canRerun).toBe(false);
  });
});

describe("listing", () => {
  it("searches, filters, sorts and pages", async () => {
    const a = singleRun({ target: "https://alpha.test/", errors: 0 });
    const b = singleRun({ target: "https://beta.test/", errors: 3 });
    const c = singleRun({ target: "Direct input", type: "html", errors: 1 });
    for (const r of [a, b, c]) await saveSingleRun(r, DEFAULT_OPTIONS, null);

    const q = (params: Record<string, string>) => listRuns(parseHistoryQuery(params), 2);
    expect((await q({})).rows.map((r) => r.id)).toEqual([c.id, b.id]);
    expect((await q({ page: "2" })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await q({ q: "beta" })).rows.map((r) => r.id)).toEqual([b.id]);
    expect((await q({ type: "direct" })).rows.map((r) => r.id)).toEqual([c.id]);
    expect((await q({ result: "passed" })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await q({ sort: "errors" })).rows[0].id).toBe(b.id);
    expect((await q({ sort: "oldest" })).rows[0].id).toBe(a.id);
    const all = await q({});
    expect(all).toMatchObject({ total: 3, pageCount: 2, totals: { runs: 3 } });

    const res = await listHistory(localRequest("/api/history?type=url&sort=score-desc"), {});
    const page = await json<HistoryPage>(res);
    expect(page.rows.map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it("finds the previous run of the same target", async () => {
    const first = singleRun({ target: "https://same.test/" });
    const other = singleRun({ target: "https://other.test/" });
    const second = singleRun({ target: "https://SAME.test/#top" });
    for (const r of [first, other, second]) await saveSingleRun(r, DEFAULT_OPTIONS, null);
    expect(await previousRunId((await loadRun(second.id))!.summary)).toBe(first.id);
    expect(await previousRunId((await loadRun(first.id))!.summary)).toBeUndefined();
  });
});

describe("bulk runs", () => {
  it("are saved as they go, and a cancelled run keeps its finished pages", async () => {
    const urls = ["https://site.test/1", "https://site.test/2", "https://site.test/3"];
    const recorder = await BulkRecorder.start({ id: randomUUID(), urls, options: DEFAULT_OPTIONS, concurrency: 2, mode: "url-list", target: "URL list", flushMs: 10 });
    let saved = (await loadRun(recorder.id))!;
    expect(saved.summary).toMatchObject({ kind: "bulk", status: "running", pageCount: 3, pagesDone: 0, targetKey: "site:https://site.test" });

    const events: BulkEvent[] = [
      { type: "page-start", index: 0, url: urls[0] },
      { type: "page-done", index: 0, url: urls[0], run: singleRun({ target: urls[0], errors: 2 }) },
      { type: "page-start", index: 1, url: urls[1] },
      { type: "page-error", index: 1, url: urls[1], error: "boom" },
      { type: "page-start", index: 2, url: urls[2] },
    ];
    for (const e of events) recorder.record(e);
    await new Promise((r) => setTimeout(r, 100));
    saved = (await loadRun(recorder.id))!;
    expect(saved.summary.status).toBe("running");
    expect(saved.summary.pagesDone).toBe(2);
    expect(saved.summary.counts.errors).toBe(2);

    await recorder.finish(true, 1234);
    saved = (await loadRun(recorder.id))!;
    expect(saved.summary).toMatchObject({ status: "cancelled", pagesDone: 2, durationMs: 1234, canRerun: true });
    expect(saved.data.kind === "bulk" && saved.data.bulk.pages.map((p) => p.status)).toEqual(["done", "error", "cancelled"]);
    expect(saved.data.kind === "bulk" && saved.data.bulk.cancelled).toBe(true);
  });

  it("marks runs left 'running' by a previous process as interrupted", async () => {
    const recorder = await BulkRecorder.start({ id: randomUUID(), urls: ["https://site.test/1"], options: DEFAULT_OPTIONS, concurrency: 1, mode: "url-list", target: "URL list" });
    const { closeDb } = await import("@/lib/history/db");
    await closeDb(); // simulate a restart
    expect((await loadRun(recorder.id))!.summary.status).toBe("interrupted");
  });
});

describe("retention", () => {
  it("keeps at most HISTORY_MAX_RUNS runs, deleting the oldest first", async () => {
    process.env.HISTORY_MAX_RUNS = "3";
    const runs = Array.from({ length: 5 }, () => singleRun());
    for (const r of runs) await saveSingleRun(r, DEFAULT_OPTIONS, null);
    const left = (await listRuns(parseHistoryQuery({ sort: "oldest" }))).rows.map((r) => r.id);
    expect(left).toEqual(runs.slice(2).map((r) => r.id));
  });

  it("keeps stored data under HISTORY_MAX_MB, deleting the oldest runs and their report files", async () => {
    process.env.HISTORY_MAX_MB = "1";
    // Random text doesn't compress: each run stores ~400 KB.
    const runs = Array.from({ length: 4 }, () => singleRun({ source: randomBytes(300 * 1024).toString("base64") }));
    await saveSingleRun(runs[0], DEFAULT_OPTIONS, null);
    await saveReport(runs[0].id, { body: "a,b\r\n", filename: "r.csv", contentType: "text/csv" }, { format: "csv", contents: { summary: true, errors: true, warnings: true, info: false, extracts: true, structure: true, outline: true, images: true }, branding: { project: "", preparedBy: "", reportDate: "2026-10-10" } });
    expect(existsSync(path.join(tmp.dir, "reports", runs[0].id))).toBe(true);
    for (const r of runs.slice(1)) await saveSingleRun(r, DEFAULT_OPTIONS, null);
    const left = (await listRuns(parseHistoryQuery({ sort: "oldest" }))).rows;
    expect(left.length).toBeLessThan(4);
    expect(left.at(-1)!.id).toBe(runs[3].id);
    expect(left.some((r) => r.id === runs[0].id)).toBe(false);
    expect(existsSync(path.join(tmp.dir, "reports", runs[0].id))).toBe(false);
    expect(left.reduce((n, r) => n + r.sizeBytes, 0)).toBeLessThanOrEqual(1024 * 1024);
  });

  it("never deletes a run in progress", async () => {
    process.env.HISTORY_MAX_RUNS = "1";
    const recorder = await BulkRecorder.start({ id: randomUUID(), urls: ["https://site.test/1"], options: DEFAULT_OPTIONS, concurrency: 1, mode: "url-list", target: "URL list" });
    const r = singleRun();
    await saveSingleRun(r, DEFAULT_OPTIONS, null);
    expect(await loadRun(recorder.id)).toBeDefined();
    expect(await loadRun(r.id)).toBeDefined();
    await recorder.finish(false, 1);
    // Once finished, the older run gives way.
    await enforceRetention();
    // The bulk run started now; the single run's date is older.
    expect((await listRuns(parseHistoryQuery({}))).rows.map((x) => x.id)).toEqual([recorder.id]);
  });

  it("compacts the database after large deletions", async () => {
    const runs = Array.from({ length: 6 }, () => singleRun({ source: randomBytes(400 * 1024).toString("base64") }));
    for (const r of runs) await saveSingleRun(r, DEFAULT_OPTIONS, null);
    const dbFile = path.join(tmp.dir, "markuplens.db");
    const db = await getDb();
    await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    const before = statSync(dbFile).size;
    const res = await deleteMany(localRequest("/api/history", { method: "DELETE", body: JSON.stringify({ ids: runs.slice(0, 5).map((r) => r.id) }) }), {});
    expect((await json<{ deleted: string[] }>(res)).deleted).toHaveLength(5);
    expect(statSync(dbFile).size).toBeLessThan(before / 2);
    expect(await compactIfNeeded(db)).toBe(false); // nothing left to reclaim
  });
});

describe("saved reports and the report API", () => {
  async function savedRun() {
    const r = singleRun({ errors: 2 });
    await saveSingleRun(r, DEFAULT_OPTIONS, { type: "url", value: r.input.target });
    return r;
  }
  const reportBody = (body: unknown) => localRequest("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST /api/report with runId saves the file (X-Report-Id) and GET /api/history/reports/:id returns it again", async () => {
    const r = await savedRun();
    const res = await postReport(reportBody({ runId: r.id, format: "csv", branding: { project: "Acme" } }), {});
    expect(res.status).toBe(200);
    const reportId = res.headers.get("X-Report-Id")!;
    expect(reportId).toMatch(/^[0-9a-f-]{36}$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toContain("Problem 1");

    const again = await getReport(localRequest(`/api/history/reports/${reportId}`), ctx({ id: reportId }));
    expect(again.status).toBe(200);
    expect(again.headers.get("Content-Disposition")).toBe(res.headers.get("Content-Disposition"));
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(bytes);

    const saved = (await loadRun(r.id))!;
    expect(saved.reports).toHaveLength(1);
    expect(saved.reports[0]).toMatchObject({ id: reportId, format: "csv" });

    expect((await deleteReport(localRequest(`/api/history/reports/${reportId}`, { method: "DELETE" }), ctx({ id: reportId }))).status).toBe(200);
    expect((await getReport(localRequest(`/api/history/reports/${reportId}`), ctx({ id: reportId }))).status).toBe(404);
  });

  it("info messages follow the run's Verbose option unless contents says otherwise", async () => {
    const r = singleRun({ errors: 0 });
    r.documents[0].messages = [msg({ severity: "info", message: "Just so you know" })];
    await saveSingleRun(r, { ...DEFAULT_OPTIONS, verbose: true }, null);
    const csv = await (await postReport(reportBody({ runId: r.id, format: "csv" }), {})).text();
    expect(csv).toContain("Just so you know");
    const without = await (await postReport(reportBody({ runId: r.id, format: "csv", contents: { info: false } }), {})).text();
    expect(without).not.toContain("Just so you know");
  });

  it("keeps the newest 20 reports per run", async () => {
    const r = await savedRun();
    const ids: string[] = [];
    for (let i = 0; i < MAX_REPORTS_PER_RUN + 2; i++) {
      const res = await postReport(reportBody({ runId: r.id, format: "json" }), {});
      ids.push(res.headers.get("X-Report-Id")!);
    }
    const saved = (await loadRun(r.id))!;
    expect(saved.reports).toHaveLength(MAX_REPORTS_PER_RUN);
    expect(saved.reports.map((x) => x.id)).not.toContain(ids[0]);
    expect(saved.reports.map((x) => x.id)).toContain(ids.at(-1));
    expect(readdirSync(path.join(tmp.dir, "reports", r.id))).toHaveLength(MAX_REPORTS_PER_RUN);
  });

  it("doesn't save a report over 100 MB", async () => {
    const r = await savedRun();
    const result = await saveReport(r.id, { body: new Uint8Array(MAX_SAVED_REPORT_BYTES + 1), filename: "huge.json", contentType: "application/json" }, { format: "json", contents: { summary: true, errors: true, warnings: true, info: false, extracts: true, structure: true, outline: true, images: true }, branding: { project: "", preparedBy: "", reportDate: "2026-10-10" } });
    expect(result.saved).toBe(false);
    expect((await loadRun(r.id))!.reports).toHaveLength(0);
  });

  it("answers 404 for an unknown runId; the old `source` form still works but saves nothing", async () => {
    expect((await postReport(reportBody({ runId: "nope", format: "csv" }), {})).status).toBe(404);
    const r = singleRun();
    const res = await postReport(reportBody({ format: "csv", source: { kind: "single", run: r } }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Report-Id")).toBeNull();
  });
});

describe("history API routes", () => {
  it("GET/DELETE /api/history/:id", async () => {
    const r = singleRun();
    await saveSingleRun(r, DEFAULT_OPTIONS, null);
    const res = await getRun(localRequest(`/api/history/${r.id}`), ctx({ id: r.id }));
    expect((await json<SavedRun>(res)).summary.id).toBe(r.id);
    expect((await deleteRun(localRequest(`/api/history/${r.id}`, { method: "DELETE" }), ctx({ id: r.id }))).status).toBe(200);
    expect((await getRun(localRequest(`/api/history/${r.id}`), ctx({ id: r.id }))).status).toBe(404);
  });

  it("compares runs as JSON and Excel", async () => {
    const a = singleRun({ errors: 2 });
    const b = singleRun({ errors: 1 });
    for (const r of [a, b]) await saveSingleRun(r, DEFAULT_OPTIONS, null);
    const res = await getCompare(localRequest(`/api/history/compare?a=${b.id}&b=${a.id}`), {});
    const result = await json<{ schema: string; before: { id: string }; totals: { fixed: number; unchanged: number } }>(res);
    expect(result).toMatchObject({ schema: "markuplens-compare", before: { id: a.id }, totals: { fixed: 1, unchanged: 1 } });

    const xlsx = await postCompare(localRequest("/api/history/compare", { method: "POST", body: JSON.stringify({ a: a.id, b: b.id, format: "xlsx", branding: { project: "Acme" } }) }), {});
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("Content-Disposition")).toMatch(/markuplens-compare-example\.com-\d{4}-\d{2}-\d{2}\.xlsx/);
    expect((await getCompare(localRequest(`/api/history/compare?a=${a.id}&b=missing`), {})).status).toBe(404);
    expect((await getCompare(localRequest(`/api/history/compare?a=${a.id}&b=${a.id}`), {})).status).toBe(400);
  });

  it("refuse requests to a foreign Host", async () => {
    const res = await listHistory(localRequest("/api/history", { headers: { host: "evil.example" } }), {});
    expect(res.status).toBe(403);
  });
});
