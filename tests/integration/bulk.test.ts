import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeBulk, type BulkPage } from "@/lib/bulk/aggregate";
import { runBulk } from "@/lib/bulk/runner";
import type { BulkEvent } from "@/lib/bulk/types";
import { DEFAULT_OPTIONS } from "@/lib/validation/options";

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
