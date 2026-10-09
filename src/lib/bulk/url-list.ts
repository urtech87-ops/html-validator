import { MAX_BULK_URLS } from "./types";

export interface ParsedUrlList {
  urls: string[];
  /** Lines that are not http(s) URLs, with their 1-based line numbers. */
  invalid: Array<{ line: number; text: string }>;
  duplicates: number;
  /** URLs beyond MAX_BULK_URLS that were dropped. */
  overLimit: number;
}

/**
 * Parse a pasted list: one URL per line. Blank lines and lines starting with
 * "#" are ignored, a missing scheme gets http://, duplicates are removed
 * (ignoring the #fragment), and the list is capped at MAX_BULK_URLS.
 */
export function parseUrlList(text: string, limit = MAX_BULK_URLS): ParsedUrlList {
  const seen = new Set<string>();
  const all: string[] = [];
  const invalid: ParsedUrlList["invalid"] = [];
  let duplicates = 0;

  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(line);
    let url: URL;
    try {
      url = new URL(hasScheme ? line : `http://${line}`);
    } catch {
      invalid.push({ line: i + 1, text: line });
      return;
    }
    // Without a scheme, a dot-less word ("hello") is more likely a typo than an intranet host.
    const looksLikeHost = hasScheme || url.hostname.includes(".") || url.hostname === "localhost";
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !looksLikeHost) {
      invalid.push({ line: i + 1, text: line });
      return;
    }
    url.hash = "";
    const key = url.href;
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);
    all.push(key);
  });

  return { urls: all.slice(0, limit), invalid, duplicates, overLimit: Math.max(0, all.length - limit) };
}
