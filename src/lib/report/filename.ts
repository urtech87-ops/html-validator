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

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
