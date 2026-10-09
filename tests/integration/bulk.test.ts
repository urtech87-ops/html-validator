import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeBulk, type BulkPage } from "@/lib/bulk/aggregate";
import { runBulk } from "@/lib/bulk/runner";
import type { BulkEvent } from "@/lib/bulk/types";
import { generateReport } from "@/lib/report/generate";
import { defaultContents } from "@/lib/report/types";
import { DEFAULT_OPTIONS } from "@/lib/validation/options";
import { pdfText } from "../helpers/pdf-text";

/**
 * A 20-page bulk run through the real pipeline (fetch → vnu → structure),
 * against a throwaway local site. Pages share one stylesheet.
 */

let server: Server;
let base = "";
const hits = new Map<string, number>();

const page = (n: number) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Test page number ${n}</title><link rel="stylesheet" href="/site.css"></head>
<body><main><h1>Page ${n}</h1>${n % 4 === 0 ? '<img src="x.png">' : ""}${n % 5 === 0 ? "<center>old</center>" : ""}<p>Text</p></main></body>
</html>`;

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_URLS = "true"; // the test site runs on 127.0.0.1
  server = createServer((req, res) => {
    hits.set(req.url!, (hits.get(req.url!) ?? 0) + 1);
    if (req.url === "/site.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end("body { colr: red; }\n");
      return;
    }
    const n = Number(/^\/p(\d+)$/.exec(req.url ?? "")?.[1]);
    if (!n) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<!DOCTYPE html><title>404</title>");
      return;
    }
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(n));
    }, 50);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  delete process.env.ALLOW_PRIVATE_URLS;
});

describe("bulk run against vnu", () => {
  it("validates 20 pages with progress events, a shared stylesheet and a correct summary", async () => {
    const urls = [...Array.from({ length: 19 }, (_, i) => `${base}/p${i + 1}`), `${base}/missing`];
    const events: BulkEvent[] = [];
    const pages: BulkPage[] = urls.map((url, index) => ({ index, url, status: "queued" }));

    await runBulk(
      urls,
      DEFAULT_OPTIONS,
      3,
      (e) => {
        events.push(e);
        if (e.type === "page-start") pages[e.index].status = "running";
        if (e.type === "page-done") Object.assign(pages[e.index], { status: "done", run: e.run });
        if (e.type === "page-error") Object.assign(pages[e.index], { status: "error", error: e.error });
      },
      new AbortController().signal,
    );

    expect(events[0]).toEqual({ type: "start", total: 20, concurrency: 3 });
    expect(events.filter((e) => e.type === "page-start")).toHaveLength(20);
    expect(events.filter((e) => e.type === "page-done")).toHaveLength(20);
    expect(events.at(-1)).toMatchObject({ type: "end", cancelled: false });
    // The stylesheet linked from 19 pages was fetched once.
    expect(hits.get("/site.css")).toBe(1);

    const s = summarizeBulk(pages);
    expect(s).toMatchObject({ total: 20, finished: 20, notValidated: 1, failed: 19, passed: 0 });
    // 19 pages: 4 missing-alt (p4,p8,p12,p16) + 3 <center> (p5,p10,p15) HTML errors, + the shared CSS error once.
    expect(s.counts.errors).toBe(4 + 3 + 1);
    const css = s.commonIssues.find((i) => i.message.includes("colr"));
    expect(css).toMatchObject({ pages: 19, occurrences: 1 });

    const p4 = pages[3].run!.documents[0];
    expect(p4.structure?.checks.find((c) => c.id === "img-alt")?.status).toBe("fail");
    expect(pages[19].run!.documents[0].fatal).toMatch(/HTTP 404/);

    // The same run as an aggregated Excel workbook and PDF (spec acceptance criterion).
    const source = { kind: "bulk" as const, target: "URL list", mode: "url-list" as const, pages, startedAt: new Date().toISOString(), cancelled: false };
    const request = { contents: defaultContents(false), branding: { project: "Bulk test", preparedBy: "CI", reportDate: "2026-10-09" }, source };

    const xlsx = await generateReport({ ...request, format: "xlsx" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((xlsx.body as Uint8Array).buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Report Info", "Summary", "Issues", "Structure", "Issue Types"]);
    // 20 pages + the shared stylesheet once.
    expect(wb.getWorksheet("Summary")!.rowCount).toBe(1 + 21);
    // Issues: 4 alt + 3 <center> + the shared CSS error once.
    const issues = wb.getWorksheet("Issues")!;
    const severityCol = (issues.getRow(1).values as unknown[]).indexOf("Severity");
    const errorRows = issues.getRows(2, issues.rowCount - 1)!.filter((r) => r.getCell(severityCol).value === "Error");
    expect(errorRows).toHaveLength(8);
    const types = wb.getWorksheet("Issue Types")!.getRows(2, 50)!.filter((r) => r.hasValues);
    const cssType = types.find((r) => String(r.getCell(1).value).includes("colr"))!;
    expect([cssType.getCell(4).value, cssType.getCell(5).value]).toEqual([19, 1]);
    const info = new Map<unknown, unknown>();
    wb.getWorksheet("Report Info")!.eachRow((r) => info.set(r.getCell(1).value, r.getCell(2).value));
    expect(info.get("Pages checked")).toBe(20);
    expect(info.get("Errors (total)")).toBe(8);
    expect(info.get("Not validated")).toBe(1);

    const pdf = await generateReport({ ...request, format: "pdf" });
    const { text } = await pdfText(pdf.body as Uint8Array);
    expect(text).toContain("Site validation report");
    expect(text).toContain("Most common issues site-wide");
    expect(text).toContain(`${base}/p19`);
    expect(text).toMatch(/HTTP 404/);
  });

  it("stops early when cancelled", async () => {
    const controller = new AbortController();
    const urls = Array.from({ length: 30 }, (_, i) => `${base}/p${i + 100}`);
    const events: BulkEvent[] = [];
    setTimeout(() => controller.abort(), 150);
    await runBulk(urls, DEFAULT_OPTIONS, 2, (e) => events.push(e), controller.signal);
    expect(events.at(-1)).toMatchObject({ type: "end", cancelled: true });
    expect(events.filter((e) => e.type === "page-start").length).toBeLessThan(30);
  });
});
