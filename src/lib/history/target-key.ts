/**
 * Target keys (client-safe): runs with the same key are runs of the same
 * thing, so "compare with previous run" can find the earlier one.
 *
 *   single URL     url:<normalised URL>
 *   direct input   direct:html | direct:css
 *   upload         upload:<sorted file names>
 *   bulk run       site:<origin>   (the sitemap's origin, or the origin most URLs share)
 */

/** Lower-case scheme and host, default port and fragment removed; path and query kept. */
export function normalizeTargetUrl(value: string): string {
  try {
    const u = new URL(value.trim());
    u.hash = "";
    return u.href;
  } catch {
    return value.trim();
  }
}

export function originOf(value: string): string | undefined {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

export function singleTargetKey(type: "url" | "html" | "css" | "upload", target: string, fileNames: string[] = []): string {
  if (type === "url") return `url:${normalizeTargetUrl(target)}`;
  if (type === "upload") return `upload:${[...fileNames].sort((a, b) => a.localeCompare(b)).join("\n")}`;
  return `direct:${type}`;
}

/** The site of a bulk run: the sitemap's origin, else the origin shared by most URLs (first one wins a tie). */
export function siteKey(urls: string[], sitemap?: string): string {
  const fromSitemap = sitemap ? originOf(sitemap) : undefined;
  if (fromSitemap) return `site:${fromSitemap}`;
  const counts = new Map<string, number>();
  for (const url of urls) {
    const origin = originOf(url);
    if (origin) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [origin, n] of counts) if (!best || n > counts.get(best)!) best = origin;
  return `site:${best ?? "unknown"}`;
}
