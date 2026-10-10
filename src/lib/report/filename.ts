import { FORMAT_META, type ReportFormat } from "./types";

/** ASCII slug of the project or target for the download name, e.g. "acme-example-com". */
export function slugify(text: string, max = 40): string {
  const slug = text
    .replace(/^https?:\/\//i, "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase()
    .slice(0, max)
    .replace(/-+$/, "");
  return slug;
}

export function reportFilename(format: ReportFormat, opts: { project?: string; target?: string; date: string }): string {
  const slug = slugify(opts.project ?? "") || slugify(opts.target ?? "") || "report";
  return `markuplens-${slug}-${opts.date}.${FORMAT_META[format].extension}`;
}

/**
 * Headers for a report download. HTML reports also get a sandboxing CSP (the
 * same policy as their <meta> one, plus `sandbox`), so even if a browser
 * displayed one inline instead of downloading it, it couldn't run script or
 * act as this origin.
 */
export function downloadHeaders(contentType: string, filename: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(filename),
    "X-Content-Type-Options": "nosniff",
  };
  if (/^text\/html(;|$)/i.test(contentType)) {
    headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'";
  }
  return headers;
}

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
