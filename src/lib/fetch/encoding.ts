import type { EncodingInfo } from "@/lib/validation/types";
import type { ValidationOptions } from "@/lib/validation/options";

/**
 * Character-encoding detection for fetched/uploaded bytes, following the
 * HTML priority order: BOM → HTTP header → <meta> (or CSS @charset).
 */

export function charsetFromContentType(contentType: string | null | undefined): string | undefined {
  const match = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "");
  return match ? match[1].toLowerCase() : undefined;
}

export function sniffBom(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return undefined;
}

/** Look for <meta charset> / http-equiv content-type in the first 1024 bytes (HTML prescan). */
export function sniffMetaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  const direct = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
  return direct ? direct[1].toLowerCase() : undefined;
}

export function sniffCssCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  const match = /^@charset\s+"([\w.:-]+)";/.exec(head);
  return match ? match[1].toLowerCase() : undefined;
}

export function isSupportedEncoding(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

export interface EncodingDecision {
  info: EncodingInfo;
  /** Charset to pass to vnu in Content-Type, or undefined to let vnu detect it. */
  charsetForVnu?: string;
}

/**
 * Decide the encoding for a document.
 * - Auto: use what the document declares. Only an HTTP-header charset is
 *   forwarded to vnu (as a real server would send it); BOM/meta are left for
 *   vnu to detect so it reports encoding problems exactly as validator.w3.org.
 * - Override: forward the chosen charset to vnu (HTTP charset beats <meta>),
 *   unless "only if missing" is set and the document declares one.
 */
export function decideEncoding(
  bytes: Uint8Array,
  opts: { contentType?: string | null; isCss: boolean; options: ValidationOptions["encoding"] },
): EncodingDecision {
  const bom = sniffBom(bytes);
  const header = charsetFromContentType(opts.contentType);
  const inDoc = opts.isCss ? sniffCssCharset(bytes) : sniffMetaCharset(bytes);
  const declared = bom ?? header ?? inDoc;
  const declaredSource: EncodingInfo["source"] | undefined = bom
    ? "bom"
    : header
      ? "http-header"
      : inDoc
        ? opts.isCss
          ? "css-charset"
          : "meta"
        : undefined;

  const override = opts.options.override;
  const applyOverride = override !== "auto" && !(opts.options.onlyIfMissing && declared);

  if (applyOverride) {
    return { info: { name: override, source: "override", declared }, charsetForVnu: override };
  }
  if (declared && declaredSource && isSupportedEncoding(declared)) {
    return {
      info: { name: declared, source: declaredSource, declared },
      charsetForVnu: declaredSource === "http-header" ? declared : undefined,
    };
  }
  // Nothing (usable) declared: UTF-8 if the bytes are valid UTF-8, else windows-1252 (HTML default).
  const fallback = isValidUtf8(bytes) ? "utf-8" : "windows-1252";
  return { info: { name: fallback, source: "fallback", declared } };
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Decode bytes for display. Never throws: falls back to UTF-8 with replacement characters. */
export function decodeBytes(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
