import type { DoctypeInfo, DocumentKind } from "./types";

const LEGACY: Array<[RegExp, string]> = [
  [/XHTML\s+1\.1/i, "XHTML 1.1"],
  [/XHTML\s+Basic/i, "XHTML Basic"],
  [/XHTML\s+1\.0\s+Strict/i, "XHTML 1.0 Strict"],
  [/XHTML\s+1\.0\s+Transitional/i, "XHTML 1.0 Transitional"],
  [/XHTML\s+1\.0\s+Frameset/i, "XHTML 1.0 Frameset"],
  [/HTML\s+4\.01\s+Transitional/i, "HTML 4.01 Transitional"],
  [/HTML\s+4\.01\s+Frameset/i, "HTML 4.01 Frameset"],
  [/HTML\s+4\.01/i, "HTML 4.01 Strict"],
  [/HTML\s+4\.0/i, "HTML 4.0"],
  [/HTML\s+3\.2/i, "HTML 3.2"],
  [/HTML\s+2\.0/i, "HTML 2.0"],
  [/MathML\s+2\.0/i, "MathML 2.0"],
  [/SMIL/i, "SMIL"],
];

/** Detect the doctype from the start of an HTML document. */
export function detectDoctype(source: string, kind: DocumentKind): DoctypeInfo {
  if (kind === "css") return { kind: "not-applicable", label: "—" };

  // Skip BOM, XML declaration, comments and whitespace before the doctype.
  const head = source.slice(0, 4096).replace(/^﻿/, "");
  const match = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>)/i.exec(head);
  if (!match) {
    if (kind === "svg") return { kind: "not-applicable", label: "SVG (no doctype)" };
    if (kind === "xhtml") return { kind: "not-applicable", label: "XHTML5 (XML, no doctype)" };
    return { kind: "missing", label: "Missing" };
  }

  const raw = match[1].replace(/\s+/g, " ");
  if (/^<!DOCTYPE\s+html\s*(SYSTEM\s+["']about:legacy-compat["']\s*)?>$/i.test(raw)) {
    return { kind: "html5", label: "HTML5", raw };
  }
  for (const [pattern, label] of LEGACY) {
    if (pattern.test(raw)) return { kind: "legacy", label, raw };
  }
  if (/^<!DOCTYPE\s+svg/i.test(raw)) return { kind: "legacy", label: "SVG 1.1", raw };
  return { kind: "legacy", label: "Unknown legacy doctype", raw };
}

export const LEGACY_DOCTYPE_NOTICE =
  "This document uses a legacy doctype. MarkupLens validates against HTML5 only (via the Nu Html Checker); DTD-based validation of older doctypes is out of scope.";
