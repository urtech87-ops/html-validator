import { describe, expect, it, vi } from "vitest";
import { RunCancelledError } from "@/lib/abort";
import { runBulk, slimRun, type ValidateFn } from "@/lib/bulk/runner";
import { parseSitemap, sitemapsFromRobots } from "@/lib/bulk/sitemap";
import type { BulkEvent } from "@/lib/bulk/types";
import { parseUrlList } from "@/lib/bulk/url-list";
import { DEFAULT_OPTIONS } from "@/lib/validation/options";
import type { DocumentResult, RunResult } from "@/lib/validation/types";

const fakeRun = (url: string, sizeBytes = 100): RunResult => ({
  id: url,
  createdAt: "",
  input: { type: "url", target: url },
  documents: [{ id: "page", source: "x".repeat(10), sizeBytes } as unknown as DocumentResult],
  counts: { errors: 0, warnings: 0, info: 0 },
  score: 100,
  passed: true,
  durationMs: 1,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("parseUrlList", () => {
  it("cleans, de-duplicates and caps a pasted list", () => {
    const text = [
      "https://example.com/",
      "  example.com/about  ",
      "",
      "# a comment",
      "https://example.com/#top",
      "ftp://example.com/file",
      "not a url",
      "hello",
      "http://devbox/",
      "http://localhost/site",
    ].join("\n");
    const parsed = parseUrlList(text);
    expect(parsed.urls).toEqual(["https://example.com/", "http://example.com/about", "http://devbox/", "http://localhost/site"]);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.invalid.map((i) => i.line)).toEqual([6, 7, 8]);
  });

  it("enforces the 200-URL limit", () => {
    const text = Array.from({ length: 250 }, (_, i) => `https://example.com/p${i}`).join("\n");
    const parsed = parseUrlList(text);
    expect(parsed.urls).toHaveLength(200);
    expect(parsed.overLimit).toBe(50);
  });
});

describe("parseSitemap", () => {
  it("reads a urlset with lastmod and resolves relative locs", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
        <url><loc>https://example.com/</loc><lastmod>2026-01-02</lastmod></url>
        <url><loc> /about </loc><image:image><image:loc>https://example.com/a.png</image:loc></image:image></url>
        <url><loc>mailto:x@example.com</loc></url>
      </urlset>`;
    const parsed = parseSitemap(xml, "https://example.com/sitemap.xml");
    expect(parsed.kind).toBe("urlset");
    expect(parsed.urls).toEqual([{ loc: "https://example.com/", lastmod: "2026-01-02" }, { loc: "https://example.com/about", lastmod: undefined }]);
  });

  it("reads a sitemap index", () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
      <sitemap><loc>https://example.com/sitemap-posts.xml.gz</loc></sitemap>
    </sitemapindex>`;
    expect(parseSitemap(xml, "https://example.com/")).toEqual({
      kind: "index",
      urls: [],
      children: ["https://example.com/sitemap-pages.xml", "https://example.com/sitemap-posts.xml.gz"],
    });
  });

  it("reads plain-text sitemaps and rejects other documents", () => {
    expect(parseSitemap("https://example.com/a\nhttps://example.com/b\n", "https://example.com/").urls).toHaveLength(2);
    expect(parseSitemap("<html><body>Not found</body></html>", "https://example.com/").kind).toBe("unknown");
  });

  it("extracts Sitemap: lines from robots.txt", () => {
    const robots = "User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\nsitemap:/news-sitemap.xml\n";
    expect(sitemapsFromRobots(robots, "https://example.com/robots.txt")).toEqual(["https://example.com/sitemap.xml", "https://example.com/news-sitemap.xml"]);
  });
});

describe("slimRun", () => {
  it("drops sources above the size limit", () => {
    const slim = slimRun(fakeRun("a", 400 * 1024));
    expect(slim.documents[0]).toMatchObject({ source: "", sourceOmitted: true });
    expect(slimRun(fakeRun("b", 10)).documents[0].source).toBe("xxxxxxxxxx");
  });
});

describe("runBulk", () => {
  it("never runs more pages at once than the concurrency limit, and emits every result", async () => {
    let active = 0;
    let peak = 0;
    const validate: ValidateFn = async (url) => {
      active++;
      peak = Math.max(peak, active);
      await sleep(5);
      active--;
      return fakeRun(url);
    };
    const events: BulkEvent[] = [];
    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
    await runBulk(urls, DEFAULT_OPTIONS, 3, (e) => events.push(e), new AbortController().signal, validate);

    expect(peak).toBe(3);
    expect(events[0]).toEqual({ type: "start", total: 10, concurrency: 3 });
    expect(events.filter((e) => e.type === "page-done")).toHaveLength(10);
    expect(events.at(-1)).toMatchObject({ type: "end", cancelled: false });
  });

  it("shares one context (signal + stylesheet cache) across pages", async () => {
    const contexts = new Set<unknown>();
    const validate: ValidateFn = async (url, _o, ctx) => {
      contexts.add(ctx.stylesheetCache);
      return fakeRun(url);
    };
    await runBulk(["https://a.test/1", "https://a.test/2"], DEFAULT_OPTIONS, 2, () => {}, new AbortController().signal, validate);
    expect(contexts.size).toBe(1);
  });

  it("reports a failing page and carries on", async () => {
    const validate: ValidateFn = async (url) => {
      if (url.endsWith("/bad")) throw new Error("boom");
      return fakeRun(url);
    };
    const events: BulkEvent[] = [];
    await runBulk(["https://a.test/ok", "https://a.test/bad", "https://a.test/ok2"], DEFAULT_OPTIONS, 1, (e) => events.push(e), new AbortController().signal, validate);
    expect(events.filter((e) => e.type === "page-error")).toEqual([{ type: "page-error", index: 1, url: "https://a.test/bad", error: "boom" }]);
    expect(events.filter((e) => e.type === "page-done")).toHaveLength(2);
  });

  it("stops starting pages when cancelled and aborts in-flight work", async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const validate: ValidateFn = vi.fn(async (url, _o, ctx) => {
      started.push(url);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 50);
        ctx.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new RunCancelledError());
        });
      });
      return fakeRun(url);
    });
    const events: BulkEvent[] = [];
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`);
    const run = runBulk(urls, DEFAULT_OPTIONS, 3, (e) => events.push(e), controller.signal, validate);
    await sleep(10);
    controller.abort();
    await run;

    expect(started).toHaveLength(3);
    expect(events.filter((e) => e.type === "page-done" || e.type === "page-error")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "end", cancelled: true });
  });
});

describe("summarizeBulk", () => {
  const msg = (message: string, severity: "error" | "warning" = "error") => ({ id: message, message, severity, category: "html", source: "vnu" }) as const;
  const doc = (id: string, origin: string, messages: ReturnType<typeof msg>[], url?: string) =>
    ({ id, origin, url, messages, counts: { errors: messages.filter((m) => m.severity === "error").length, warnings: messages.filter((m) => m.severity === "warning").length, info: 0 } }) as unknown as DocumentResult;
  const run = (docs: DocumentResult[], score: number, passed: boolean): RunResult =>
    ({ id: Math.random().toString(), documents: docs, score, passed, counts: { errors: 0, warnings: 0, info: 0 }, durationMs: 1 }) as unknown as RunResult;

  it("counts statuses, pass/fail, average score and site-wide issues", async () => {
    const { summarizeBulk } = await import("@/lib/bulk/aggregate");
    const sharedCss = (n: string) => doc(n, "stylesheet", [msg("CSS: bad value")], "https://a.test/site.css");
    const pages = [
      { index: 0, url: "https://a.test/1", status: "done" as const, run: run([doc("page", "url", [msg("Duplicate ID “x”."), msg("Duplicate ID “x”.")]), sharedCss("css-1")], 85, false) },
      { index: 1, url: "https://a.test/2", status: "done" as const, run: run([doc("page", "url", [msg("Duplicate ID “x”."), msg("Section lacks heading.", "warning")]), sharedCss("css-1")], 89, false) },
      { index: 2, url: "https://a.test/3", status: "done" as const, run: run([doc("page", "url", [])], 100, true) },
      { index: 3, url: "https://a.test/404", status: "done" as const, run: run([{ ...doc("page", "url", [msg("HTTP 404")]), fatal: "HTTP 404" } as DocumentResult], 95, false) },
      { index: 4, url: "https://a.test/x", status: "error" as const, error: "boom" },
      { index: 5, url: "https://a.test/y", status: "cancelled" as const },
    ];
    const s = summarizeBulk(pages);
    expect(s).toMatchObject({ total: 6, finished: 6, passed: 1, failed: 2, notValidated: 2, averageScore: 91 });
    expect(s.byStatus).toEqual({ queued: 0, running: 0, done: 4, error: 1, cancelled: 1 });
    // The shared stylesheet's error is counted once site-wide, not once per page.
    expect(s.counts).toEqual({ errors: 4, warnings: 1, info: 0 });
    expect(s.commonIssues.map((i) => [i.message, i.pages, i.occurrences])).toEqual([
      ["Duplicate ID “x”.", 2, 3],
      ["CSS: bad value", 2, 1],
      ["Section lacks heading.", 1, 1],
    ]);
  });
});
