import type { MessageCategory, Severity, ValidationMessage } from "@/lib/validation/types";
import type { VnuRawMessage } from "./client";

/**
 * vnu → normalised severity:
 *   type "error"                     → error (subType "fatal" included)
 *   type "non-document-error"        → error (I/O, schema, internal problems)
 *   type "info" + subType "warning"  → warning
 *   type "info"                      → info
 */
export function vnuSeverity(raw: VnuRawMessage): Severity {
  if (raw.type === "error" || raw.type === "non-document-error") return "error";
  if (raw.type === "info" && raw.subType === "warning") return "warning";
  return "info";
}

export function vnuCategory(raw: VnuRawMessage, documentIsCss: boolean): MessageCategory {
  if (raw.type === "non-document-error") return "document";
  if (raw.lastLine === undefined && raw.firstLine === undefined) return "document";
  if (documentIsCss) return "css";
  return /^CSS: /.test(raw.message ?? "") ? "css" : "html";
}

/**
 * Convert raw vnu messages to the app's format. vnu omits `firstLine` when it
 * equals `lastLine`, and sometimes omits `firstColumn`; both are filled in.
 */
export function normalizeVnuMessages(
  raw: VnuRawMessage[],
  documentId: string,
  documentIsCss: boolean,
): ValidationMessage[] {
  return raw.map((m, index) => {
    const lastLine = m.lastLine;
    const firstLine = m.firstLine ?? lastLine;
    const firstColumn = m.firstColumn ?? (firstLine === lastLine ? m.lastColumn : undefined);
    return {
      id: `${documentId}:${index}`,
      severity: vnuSeverity(m),
      category: vnuCategory(m, documentIsCss),
      message: (m.message ?? "Unknown message").trim(),
      source: "vnu",
      vnuType: m.type,
      vnuSubType: m.subType,
      firstLine,
      firstColumn,
      lastLine,
      lastColumn: m.lastColumn,
      extract: m.extract,
      hiliteStart: m.hiliteStart,
      hiliteLength: m.hiliteLength,
    } satisfies ValidationMessage;
  });
}
