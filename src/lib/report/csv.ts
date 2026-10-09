import { CATEGORY_LABEL, SEVERITY_LABEL, type ReportModel } from "./model";
import { MAX_ISSUE_ROWS } from "./types";

/**
 * CSV report: issues only, one row per message (RFC 4180, CRLF, UTF-8 with
 * a BOM so Excel shows Arabic and other non-Latin text correctly).
 */

/** Cells starting with these could be run as formulas by spreadsheet apps (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderCsv(model: ReportModel): string {
  const extracts = model.contents.extracts;
  const header = ["Issue ID", "Page URL", "Document", "Severity", "Type", "Message", "Line", "Column", ...(extracts ? ["Extract"] : []), "Suggested fix", "Checker"];
  const lines = [header.map(csvCell).join(",")];
  let rows = 0;
  documents: for (const d of model.documents) {
    for (const i of d.issues) {
      if (rows++ >= MAX_ISSUE_ROWS) break documents;
      lines.push(
        [
          i.id,
          i.pageUrl,
          i.document,
          SEVERITY_LABEL[i.severity],
          CATEGORY_LABEL[i.category],
          i.message,
          i.line,
          i.column,
          ...(extracts ? [i.extract] : []),
          i.fix,
          i.checker === "markuplens" ? "MarkupLens" : "Nu Html Checker",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
