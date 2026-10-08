import type { ValidationOptions } from "./options";
import type { DocumentKind, ValidationMessage } from "./types";

/**
 * CSS options applied to vnu output (no jigsaw in v1).
 *
 * vnu's CSS checker reports errors only, and it accepts vendor-prefixed
 * properties (-webkit-, -moz-, -ms-, -o-) silently. So:
 *
 * Warning level (applies to CSS-category messages):
 *   none   → CSS errors only
 *   normal → + CSS warnings                          (default)
 *   more   → + CSS info messages
 *   all    → same as "more" (kept for parity with the W3C CSS validator options)
 *
 * Vendor prefixes:
 *   ignore → drop any vnu message about a vendor-prefixed property/value (default)
 *   warn   → MarkupLens adds a warning for each vendor-prefixed property
 *            declaration (see findVendorPrefixes), because vnu emits none.
 */

const VENDOR_IN_MESSAGE = /[“"']-(?:webkit|moz|ms|o)-[\w-]+/i;

export function applyCssOptions(messages: ValidationMessage[], css: ValidationOptions["css"]): ValidationMessage[] {
  return messages.filter((m) => {
    if (m.category !== "css") return true;
    if (css.vendorPrefixes === "ignore" && m.source === "vnu" && VENDOR_IN_MESSAGE.test(m.message)) return false;
    if (m.severity === "warning" && css.warningLevel === "none") return false;
    if (m.severity === "info" && (css.warningLevel === "none" || css.warningLevel === "normal")) return false;
    return true;
  });
}

/** Drop plain info messages unless verbose output is on (CSS info is governed by the warning level). */
export function applyVerbosity(messages: ValidationMessage[], verbose: boolean, cssLevel: ValidationOptions["css"]["warningLevel"]): ValidationMessage[] {
  if (verbose) return messages;
  return messages.filter((m) => {
    if (m.severity !== "info") return true;
    return m.category === "css" && (cssLevel === "more" || cssLevel === "all");
  });
}

const VENDOR_PROPERTY = /(^|[\s;{"'])(-(?:webkit|moz|ms|o)-[a-z][\w-]*)\s*:/gi;

interface Region {
  start: number;
  end: number;
}

/** Character ranges of CSS inside a document: the whole file for CSS, <style> bodies and style="" values for HTML. */
function cssRegions(source: string, kind: DocumentKind): Region[] {
  if (kind === "css") return [{ start: 0, end: source.length }];
  const regions: Region[] = [];
  for (const m of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const bodyStart = (m.index ?? 0) + m[0].indexOf(">") + 1;
    regions.push({ start: bodyStart, end: bodyStart + m[1].length });
  }
  for (const m of source.matchAll(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi)) {
    const valueStart = (m.index ?? 0) + m[0].indexOf(m[1]) + 1;
    regions.push({ start: valueStart, end: valueStart + m[1].length - 2 });
  }
  return regions;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

function position(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

/** Supplementary check: one warning per vendor-prefixed property declaration. */
export function findVendorPrefixes(source: string, kind: DocumentKind, documentId: string): ValidationMessage[] {
  const starts = lineStarts(source);
  const out: ValidationMessage[] = [];
  for (const region of cssRegions(source, kind)) {
    const text = source.slice(region.start, region.end);
    for (const m of text.matchAll(VENDOR_PROPERTY)) {
      const propStart = region.start + (m.index ?? 0) + m[1].length;
      const prop = m[2];
      const { line, column } = position(starts, propStart);
      const extractStart = Math.max(0, propStart - 10);
      out.push({
        id: `${documentId}:vendor:${out.length}`,
        severity: "warning",
        category: "css",
        source: "markuplens",
        message: `Vendor-prefixed property “${prop}”. Prefer the standard property where browser support allows.`,
        firstLine: line,
        lastLine: line,
        firstColumn: column,
        lastColumn: column + prop.length - 1,
        extract: source.slice(extractStart, propStart + prop.length + 20),
        hiliteStart: propStart - extractStart,
        hiliteLength: prop.length,
      });
    }
  }
  return out;
}
