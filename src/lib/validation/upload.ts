import type { DocumentKind } from "./types";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 20;
export const ACCEPTED_EXTENSIONS = [".html", ".htm", ".xhtml", ".css", ".svg"] as const;

/** MIME types browsers report for the accepted extensions ("" and octet-stream occur on Windows). */
const ACCEPTED_MIME = new Set([
  "",
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
  "text/css",
  "image/svg+xml",
  "text/plain",
  "application/octet-stream",
]);

const BINARY_SIGNATURES: Array<[string, number[]]> = [
  ["ZIP archive", [0x50, 0x4b, 0x03, 0x04]],
  ["GZIP archive", [0x1f, 0x8b]],
  ["RAR archive", [0x52, 0x61, 0x72, 0x21]],
  ["7-Zip archive", [0x37, 0x7a, 0xbc, 0xaf]],
  ["PDF document", [0x25, 0x50, 0x44, 0x46]],
  ["Windows executable", [0x4d, 0x5a]],
  ["ELF executable", [0x7f, 0x45, 0x4c, 0x46]],
  ["PNG image", [0x89, 0x50, 0x4e, 0x47]],
  ["JPEG image", [0xff, 0xd8, 0xff]],
  ["GIF image", [0x47, 0x49, 0x46, 0x38]],
];

export type UploadCheck = { ok: true; kind: DocumentKind } | { ok: false; error: string };

export function extensionKind(name: string): DocumentKind | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".xhtml")) return "xhtml";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".svg")) return "svg";
  return undefined;
}

/** True when the bytes look binary: a known file signature, or NUL bytes in a non-UTF-16 file. */
export function looksBinary(bytes: Uint8Array): string | undefined {
  for (const [label, sig] of BINARY_SIGNATURES) {
    if (sig.every((b, i) => bytes[i] === b)) return label;
  }
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (!utf16 && bytes.subarray(0, 8192).includes(0)) return "binary file";
  return undefined;
}

/** Validate an uploaded file's extension, MIME type, size and content. */
export function checkUpload(name: string, mime: string, size: number, bytes?: Uint8Array): UploadCheck {
  const kind = extensionKind(name);
  if (!kind) return { ok: false, error: `“${name}”: only ${ACCEPTED_EXTENSIONS.join(", ")} files are accepted.` };
  if (!ACCEPTED_MIME.has(mime.toLowerCase())) return { ok: false, error: `“${name}”: file type “${mime}” is not accepted.` };
  if (size === 0) return { ok: false, error: `“${name}” is empty.` };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: `“${name}” is larger than 5 MB.` };
  if (bytes) {
    const binary = looksBinary(bytes);
    if (binary) return { ok: false, error: `“${name}” looks like a ${binary}, not a text file.` };
  }
  return { ok: true, kind };
}
