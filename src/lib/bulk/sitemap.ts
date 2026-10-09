import "server-only";
import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { FetchFailedError, parseUserUrl, safeFetch, type SafeFetchOptions } from "@/lib/fetch/safe-fetch";
import { BlockedUrlError } from "@/lib/fetch/ssrf";
import type { SitemapDiscovery, SitemapUrl } from "./types";

/** Stop collecting after this many page URLs (the run itself is capped at 200). */
export const MAX_DISCOVERED_URLS = 50_000;
/** Maximum sitemap files read, including children of sitemap indexes. */
export const MAX_SITEMAP_FILES = 50;
/** Maximum nesting of sitemap indexes. */
export const MAX_SITEMAP_DEPTH = 3;
/** Guard against gzip bombs. */
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

const XML_ACCEPT = "application/xml,text/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5";

type FetchOpts = Omit<SafeFetchOptions, "accept">;

export interface ParsedSitemap {
  kind: "urlset" | "index" | "text" | "unknown";
  urls: SitemapUrl[];
  /** Child sitemap URLs (sitemap index). */
  children: string[];
}

function decompress(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new Uint8Array(gunzipSync(bytes, { maxOutputLength: MAX_UNZIPPED_BYTES }));
  }
  return bytes;
}

function absolute(loc: string, base: string): string | undefined {
  try {
    const url = new URL(loc.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

/** Parse an XML sitemap, a sitemap index, or a plain-text list of URLs. */
export function parseSitemap(body: string, base: string): ParsedSitemap {
  const text = body.replace(/^﻿/, "").trim();
  if (text.startsWith("<")) {
    const $ = cheerio.load(text, { xml: { xmlMode: true } });
    // Namespaced documents still use local element names "urlset" / "sitemapindex".
    const index = $("sitemapindex, sitemap\\:sitemapindex");
    if (index.length) {
      const children = $("sitemap > loc, sitemap\\:sitemap > sitemap\\:loc")
        .toArray()
        .map((el) => absolute($(el).text(), base))
        .filter((u): u is string => !!u);
      return { kind: "index", urls: [], children };
    }
    if ($("urlset, sitemap\\:urlset").length) {
      const urls = $("url, sitemap\\:url")
        .toArray()
        .map((el): SitemapUrl | undefined => {
          const loc = absolute($(el).find("loc, sitemap\\:loc").first().text(), base);
          const lastmod = $(el).find("lastmod, sitemap\\:lastmod").first().text().trim() || undefined;
          return loc ? { loc, lastmod } : undefined;
        })
        .filter((u): u is SitemapUrl => !!u);
      return { kind: "urlset", urls, children: [] };
    }
    return { kind: "unknown", urls: [], children: [] };
  }
  // Plain-text sitemap: one absolute URL per line.
  const urls = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l))
    .map((l) => absolute(l, base))
    .filter((u): u is string => !!u)
    .map((loc) => ({ loc }));
  return { kind: urls.length ? "text" : "unknown", urls, children: [] };
}

/** Extract "Sitemap:" lines from robots.txt. */
export function sitemapsFromRobots(robots: string, base: string): string[] {
  return robots
    .split(/\r\n|\r|\n/)
    .map((l) => /^\s*sitemap\s*:\s*(\S+)/i.exec(l)?.[1])
    .filter((u): u is string => !!u)
    .map((u) => absolute(u, base))
    .filter((u): u is string => !!u);
}

function looksLikeSitemapUrl(url: URL): boolean {
  return /\.xml(\.gz)?$|\.txt$|sitemap/i.test(url.pathname);
}

function describeError(err: unknown): string {
  if (err instanceof BlockedUrlError || err instanceof FetchFailedError) return err.message;
  if (err instanceof Error && /unexpected end|incorrect header|maxOutputLength|buffer/i.test(err.message)) return "Could not decompress the gzip file.";
  throw err;
}

async function fetchSitemap(url: string, opts: FetchOpts): Promise<{ ok: true; parsed: ParsedSitemap } | { ok: false; status?: number; detail: string }> {
  try {
    const res = await safeFetch(url, { ...opts, accept: XML_ACCEPT });
    if (res.status >= 400) return { ok: false, status: res.status, detail: `HTTP ${res.status}` };
    const body = new TextDecoder("utf-8").decode(decompress(res.bytes));
    const parsed = parseSitemap(body, res.finalUrl);
    if (parsed.kind === "unknown") return { ok: false, status: res.status, detail: "Not a sitemap (no <urlset> or <sitemapindex>)." };
    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, detail: describeError(err) };
  }
}

/**
 * Discover page URLs for a site. Input is either a sitemap URL (…/sitemap.xml,
 * .xml.gz, .txt, or a path containing "sitemap") or a site root, in which
 * case /sitemap.xml, /sitemap_index.xml and then robots.txt "Sitemap:" lines
 * are tried in that order. Sitemap indexes are followed (depth ≤ 3, ≤ 50 files).
 */
export async function discoverSitemap(input: string, opts: FetchOpts): Promise<SitemapDiscovery> {
  const result: SitemapDiscovery = { input, tried: [], sitemaps: [], urls: [], truncated: false, warnings: [] };
  const start = parseUserUrl(input);
  // Files already downloaded while probing, so the walk below doesn't fetch them twice.
  const fetched = new Map<string, Awaited<ReturnType<typeof fetchSitemap>>>();
  const load = async (url: string) => {
    const cached = fetched.get(url);
    if (cached) return cached;
    const res = await fetchSitemap(url, opts);
    fetched.set(url, res);
    return res;
  };

  // 1. Which sitemap file(s) to start from.
  let roots: string[] = [];
  if (looksLikeSitemapUrl(start) && start.pathname !== "/") {
    roots = [start.href];
  } else {
    for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
      const candidate = new URL(path, start.origin).href;
      const res = await load(candidate);
      if (res.ok) {
        result.tried.push({ url: candidate, outcome: "found" });
        roots = [candidate];
        break;
      }
      result.tried.push({ url: candidate, outcome: res.status === 404 || res.status === 410 ? "not-found" : "error", detail: res.detail });
    }
    if (roots.length === 0) {
      const robotsUrl = new URL("/robots.txt", start.origin).href;
      try {
        const robots = await safeFetch(robotsUrl, { ...opts, accept: "text/plain,*/*;q=0.5" });
        if (robots.status >= 400) {
          result.tried.push({ url: robotsUrl, outcome: robots.status === 404 || robots.status === 410 ? "not-found" : "error", detail: `HTTP ${robots.status}` });
        } else {
          const listed = sitemapsFromRobots(new TextDecoder().decode(robots.bytes), robots.finalUrl);
          result.tried.push({ url: robotsUrl, outcome: listed.length ? "found" : "not-found", detail: listed.length ? `${listed.length} Sitemap: line(s)` : "No Sitemap: lines" });
          roots = listed;
        }
      } catch (err) {
        result.tried.push({ url: robotsUrl, outcome: "error", detail: describeError(err) });
      }
    }
  }
  if (roots.length === 0) return result;

  // 2. Breadth-first walk through indexes and url sets.
  const seenFiles = new Set<string>();
  const seenUrls = new Set<string>();
  let queue = roots.map((url) => ({ url, depth: 0 }));
  while (queue.length && !result.truncated) {
    const next: typeof queue = [];
    for (const { url, depth } of queue) {
      if (seenFiles.has(url)) continue;
      if (seenFiles.size >= MAX_SITEMAP_FILES) {
        result.warnings.push(`Stopped after reading ${MAX_SITEMAP_FILES} sitemap files.`);
        queue = [];
        break;
      }
      seenFiles.add(url);
      const res = await load(url);
      if (!res.ok) {
        result.warnings.push(`${url}: ${res.detail}`);
        if (!result.tried.some((t) => t.url === url)) result.tried.push({ url, outcome: res.status === 404 ? "not-found" : "error", detail: res.detail });
        continue;
      }
      if (!result.tried.some((t) => t.url === url) && depth === 0) result.tried.push({ url, outcome: "found" });
      result.sitemaps.push(url);
      if (res.parsed.kind === "index") {
        if (depth + 1 > MAX_SITEMAP_DEPTH) result.warnings.push(`${url}: sitemap index nested deeper than ${MAX_SITEMAP_DEPTH} levels was not followed.`);
        else next.push(...res.parsed.children.map((child) => ({ url: child, depth: depth + 1 })));
        continue;
      }
      for (const u of res.parsed.urls) {
        if (seenUrls.has(u.loc)) continue;
        if (result.urls.length >= MAX_DISCOVERED_URLS) {
          result.truncated = true;
          break;
        }
        seenUrls.add(u.loc);
        result.urls.push(u);
      }
      if (result.truncated) break;
    }
    queue = result.truncated ? [] : next;
  }
  if (result.truncated) result.warnings.push(`Only the first ${MAX_DISCOVERED_URLS.toLocaleString("en")} URLs are listed.`);
  return result;
}
