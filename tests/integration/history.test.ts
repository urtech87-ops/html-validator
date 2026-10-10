import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as bulkPost } from "@/app/api/bulk/route";
import { POST as rerunPost } from "@/app/api/history/[id]/rerun/route";
import { GET as savedReportGet } from "@/app/api/history/reports/[id]/route";
import { POST as reportPost } from "@/app/api/report/route";
import { POST as uploadPost } from "@/app/api/validate/upload/route";
import { POST as validatePost } from "@/app/api/validate/route";
import type { BulkEvent } from "@/lib/bulk/types";
import { loadComparison } from "@/lib/history/comparison";
import { loadRun, previousRunId } from "@/lib/history/store";
import type { RunResult } from "@/lib/validation/types";
import { ctx, localRequest, useTempDataDir, type TempDataDir } from "../helpers/temp-db";

/**
 * History end to end through the API route handlers, with the real vnu:
 * every run is saved, reports of saved runs are saved, runs can be re-run and compared.
 */

type Saved = RunResult & { runId?: string; saveError?: string };

let tmp: TempDataDir;
beforeEach(async () => {
  tmp = await useTempDataDir("it");
});
afterEach(async () => {
  await tmp.cleanup();
});

const post = (url: string, body: unknown, init: RequestInit = {}) =>
  localRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...init });

const fixture = readFileSync(path.resolve("tests/fixtures/01-structure.html"), "utf8");

describe("single runs", () => {
  it("POST /api/validate saves the run, a fixed version compares as fixed, and save:false saves nothing", async () => {
    const first = (await (await validatePost(post("/api/validate", { type: "html", value: fixture }), {})).json()) as Saved;
    expect(first.runId).toBe(first.id);
    expect(first.counts.errors).toBeGreaterThan(0);

    // "Fix" the page: drop every line with an error.
    const errorLines = new Set(first.documents[0].messages.filter((m) => m.severity === "error").map((m) => m.firstLine ?? m.lastLine));
    const fixedHtml = fixture
      .split("\n")
      .filter((_, i) => !errorLines.has(i + 1))
      .join("\n");
    const second = (await (await validatePost(post("/api/validate", { type: "html", value: fixedHtml }), {})).json()) as Saved;
    expect(second.runId).toBeDefined();
    expect(second.counts.errors).toBeLessThan(first.counts.errors);

    const saved = (await loadRun(second.runId!))!;
    expect(saved.summary.targetKey).toBe("direct:html");
    expect(await previousRunId(saved.summary)).toBe(first.runId);
    const comparison = (await loadComparison(first.runId!, second.runId!))!;
    expect(comparison.totals.fixed).toBeGreaterThan(0);
    expect(comparison.totals.fixed + comparison.totals.unchanged).toBe(first.documents[0].messages.length);

    const unsaved = (await (await validatePost(post("/api/validate", { type: "css", value: "a { colr: red }", save: false }), {})).json()) as Saved;
    expect(unsaved.runId).toBeUndefined();
    expect(await loadRun(unsaved.id)).toBeUndefined();
  });

  it("uploads are saved with their files and re-run with the original options", async () => {
    const form = new FormData();
    form.append("files", new File([fixture], "page.html", { type: "text/html" }));
    form.append("files", new File(["a { colr: red }"], "site.css", { type: "text/css" }));
    form.append("options", JSON.stringify({ verbose: true }));
    const run = (await (await uploadPost(localRequest("/api/validate/upload", { method: "POST", body: form }), {})).json()) as Saved;
    expect(run.runId).toBeDefined();
    const saved = (await loadRun(run.runId!))!;
    expect(saved.summary).toMatchObject({ inputType: "upload", target: "page.html, site.css", canRerun: true });
    expect(saved.options.verbose).toBe(true);

    const res = await rerunPost(localRequest(`/api/history/${run.runId}/rerun`, { method: "POST" }), ctx({ id: run.runId! }));
    const { runId } = (await res.json()) as { runId: string };
    expect(runId).not.toBe(run.runId);
    const again = (await loadRun(runId))!;
    expect(again.options.verbose).toBe(true);
    expect(again.summary.counts).toEqual(saved.summary.counts);
    const comparison = (await loadComparison(run.runId!, runId))!;
    expect(comparison.totals).toMatchObject({ new: 0, fixed: 0 });
  });

  it("a report of a saved run is saved and can be downloaded again", async () => {
    const run = (await (await validatePost(post("/api/validate", { type: "html", value: fixture }), {})).json()) as Saved;
    const res = await reportPost(post("/api/report", { runId: run.runId, format: "xlsx", branding: { project: "Acme" } }), {});
    expect(res.status).toBe(200);
    const id = res.headers.get("X-Report-Id")!;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const again = await savedReportGet(localRequest(`/api/history/reports/${id}`), ctx({ id }));
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(bytes);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Report Info", "Summary", "Issues", "Structure", "Issue Types"]);
  });
});

describe("bulk runs", () => {
  let server: Server;
  let base = "";
  let version = 1;
  const html = (n: number) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>History test page ${n}</title><link rel="stylesheet" href="/site.css"></head>
<body><main><h1>Page ${n}</h1>${version === 1 && n === 1 ? "<center>old</center>" : ""}${version === 2 && n === 2 ? '<img src="x.png">' : ""}<p>Text</p></main></body></html>`;

  beforeAll(async () => {
    process.env.ALLOW_PRIVATE_URLS = "true";
    server = createServer((req, res) => {
      if (req.url === "/site.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end("body { colr: red; }\n");
        return;
      }
      const n = Number(/^\/p(\d+)$/.exec(req.url ?? "")?.[1]);
      setTimeout(() => {
        res.writeHead(n ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
        res.end(n ? html(n) : "<!DOCTYPE html><title>404</title>");
      }, 80);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    delete process.env.ALLOW_PRIVATE_URLS;
  });

  async function consume(res: Response, onEvent?: (e: BulkEvent) => void): Promise<BulkEvent[]> {
    const events: BulkEvent[] = [];
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line) as BulkEvent;
          events.push(event);
          onEvent?.(event);
        }
      }
    } catch {
      // aborted
    }
    return events;
  }

  it("saves a bulk run, reports on it, and compares it with the next run of the site", async () => {
    const urls = [1, 2, 3, 4].map((n) => `${base}/p${n}`);
    version = 1;
    const events = await consume(await bulkPost(post("/api/bulk", { urls, concurrency: 2 }), {}));
    const start = events[0] as Extract<BulkEvent, { type: "start" }>;
    const end = events.at(-1) as Extract<BulkEvent, { type: "end" }>;
    expect(start.runId).toBeDefined();
    expect(end).toMatchObject({ type: "end", cancelled: false, runId: start.runId });
    const first = (await loadRun(start.runId!))!;
    expect(first.summary).toMatchObject({ kind: "bulk", status: "done", pageCount: 4, pagesDone: 4, targetKey: `site:${base}` });

    const report = await reportPost(post("/api/report", { runId: start.runId, format: "xlsx" }), {});
    expect(report.headers.get("X-Report-Id")).toBeTruthy();

    version = 2;
    const next = await consume(await bulkPost(post("/api/bulk", { urls: [...urls.slice(0, 3), `${base}/p5`], concurrency: 2 }), {}));
    const secondId = (next[0] as Extract<BulkEvent, { type: "start" }>).runId!;
    const second = (await loadRun(secondId))!;
    expect(await previousRunId(second.summary)).toBe(start.runId);

    const comparison = (await loadComparison(start.runId!, secondId))!;
    expect(comparison.pages).toMatchObject({ compared: 3, added: [`${base}/p5`], removed: [`${base}/p4`] });
    expect(comparison.issues.filter((i) => i.change === "fixed").map((i) => i.pageUrl)).toEqual([`${base}/p1`]);
    expect(comparison.issues.filter((i) => i.change === "new").map((i) => i.pageUrl)).toEqual([`${base}/p2`]);
    // The stylesheet linked from every page is compared once.
    const sheets = comparison.documents.filter((d) => d.role === "stylesheet");
    expect(sheets).toHaveLength(1);
    expect(sheets[0].unchanged).toBeGreaterThan(0);
  });

  it("a cancelled bulk run is saved with the pages it finished", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `${base}/p${i + 1}`);
    const controller = new AbortController();
    let done = 0;
    let runId: string | undefined;
    const res = await bulkPost(post("/api/bulk", { urls, concurrency: 1 }, { signal: controller.signal }), {});
    await consume(res, (e) => {
      if (e.type === "start") runId = e.runId;
      if (e.type === "page-done" && ++done === 2) controller.abort();
    });
    // The final save happens after the queue stops.
    for (let i = 0; i < 50; i++) {
      const s = await loadRun(runId!);
      if (s?.summary.status !== "running") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const saved = (await loadRun(runId!))!;
    expect(saved.summary.status).toBe("cancelled");
    expect(saved.summary.pagesDone).toBeGreaterThanOrEqual(2);
    expect(saved.summary.pagesDone).toBeLessThan(10);
    const pages = saved.data.kind === "bulk" ? saved.data.bulk.pages : [];
    expect(pages.filter((p) => p.status === "done").length).toBe(saved.summary.pagesDone);
    expect(pages.at(-1)!.status).toBe("cancelled");
  });
});
