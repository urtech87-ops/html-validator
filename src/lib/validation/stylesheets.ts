import * as cheerio from "cheerio";

export const MAX_STYLESHEETS = 20;

export interface DiscoveredStyles {
  /** Absolute stylesheet URLs, de-duplicated, in document order. */
  stylesheets: string[];
  /** Stylesheets beyond MAX_STYLESHEETS that were not fetched. */
  skipped: number;
  /** Number of inline <style> elements. */
  inlineStyleBlocks: number;
}

/**
 * Find <link rel="stylesheet" href> and <style> elements. Respects <base href>.
 * Only http(s) stylesheets are returned; data: and other schemes are ignored.
 */
export function discoverStyles(html: string, pageUrl: string): DiscoveredStyles {
  const $ = cheerio.load(html);

  let base = pageUrl;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).href;
    } catch {
      // invalid <base>: keep the page URL
    }
  }

  const seen = new Set<string>();
  const all: string[] = [];
  $("link[href]").each((_, el) => {
    const rel = ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet")) return;
    try {
      const url = new URL($(el).attr("href")!, base);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      url.hash = "";
      if (!seen.has(url.href)) {
        seen.add(url.href);
        all.push(url.href);
      }
    } catch {
      // unparseable href: vnu reports it as an HTML error already
    }
  });

  return {
    stylesheets: all.slice(0, MAX_STYLESHEETS),
    skipped: Math.max(0, all.length - MAX_STYLESHEETS),
    inlineStyleBlocks: $("style").length,
  };
}
