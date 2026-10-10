import "server-only";
import ExcelJS from "exceljs";
import { hasRtlText } from "@/lib/analysis/rtl";
import { addRow, addStatusDropdown, addTable, CHECK_STYLE, date, SEVERITY_STYLE, tint, type Cell, type Column } from "@/lib/report/excel";
import { SEVERITY_LABEL } from "@/lib/report/model";
import { MAX_ISSUE_ROWS } from "@/lib/report/types";
import { CHANGE_LABEL, DOCUMENT_STATUS_LABEL, type CompareDocument, type CompareResult, type CompareRunInfo, type IssueChange } from "./compare-types";
import { INPUT_TYPE_LABEL, STATUS_LABEL } from "./types";

/**
 * "Download comparison (Excel)": Comparison Info, Pages, Issues. Same styling
 * as the report workbook (frozen, filtered headers; RTL cells right-to-left).
 */

export interface CompareBranding {
  project: string;
  preparedBy: string;
  reportDate: string;
}

const CHANGE_STYLE: Record<IssueChange, { fill: string; font: string }> = {
  new: SEVERITY_STYLE.error,
  fixed: CHECK_STYLE.pass,
  unchanged: { fill: "FFF3F4F6", font: "FF374151" },
};

const ROLE_LABEL: Record<CompareDocument["role"], string> = { page: "Page", stylesheet: "Stylesheet", file: "File", direct: "Direct input" };

const WARNING_STYLE = { fill: "FFFEF3C7", font: "FF92400E" };

function runRows(label: string, run: CompareRunInfo): Array<[string, Cell, string?]> {
  return [
    [`${label} run`, run.target],
    [`${label} run date`, date(run.createdAt), "yyyy-mm-dd hh:mm"],
    [`${label} run ID`, run.id],
    [`${label} input type`, INPUT_TYPE_LABEL[run.inputType]],
    [`${label} status`, STATUS_LABEL[run.status]],
    [`${label} ${run.kind === "bulk" ? "average score" : "score"}`, run.score ?? "—"],
    [`${label} errors / warnings / info`, `${run.counts.errors} / ${run.counts.warnings} / ${run.counts.info}`],
  ];
}

function infoSheet(wb: ExcelJS.Workbook, result: CompareResult, branding: CompareBranding) {
  const columns: Column[] = [
    { header: "Field", width: 34 },
    { header: "Value", width: 90, wrap: true },
  ];
  const ws = addTable(wb, "Comparison Info", columns);
  const { before, after, totals } = result;
  const rows: Array<[string, Cell, string?]> = [
    ["Report", "MarkupLens run comparison"],
    ["Client / project", branding.project || "—"],
    ["Prepared by", branding.preparedBy || "—"],
    ["Report date", branding.reportDate],
    ["Generated", date(result.generatedAt), "yyyy-mm-dd hh:mm"],
    ...runRows("Earlier", before),
    ...runRows("Later", after),
  ];
  if (before.score !== undefined && after.score !== undefined) {
    const delta = after.score - before.score;
    rows.push(["Score change", `${delta > 0 ? "+" : ""}${delta}`]);
  }
  rows.push(["New issues", totals.new], ["Fixed issues", totals.fixed], ["Unchanged issues", totals.unchanged]);
  if (totals.severityChanged > 0) rows.push(["Unchanged, severity changed", totals.severityChanged]);
  if (result.pages) {
    rows.push(
      ["Pages compared", result.pages.compared],
      ["Pages only in the later run", result.pages.added.length],
      ["Pages only in the earlier run", result.pages.removed.length],
      ["Pages not comparable", result.pages.notComparable.length],
    );
  }
  rows.push([
    "Matching",
    "Issues are matched by Issue ID (document URL + message + source extract; line numbers ignored), the same ID as in the Excel report.",
  ]);

  for (const [field, value, numFmt] of rows) {
    const row = addRow(ws, columns, [field, value]);
    row.getCell(1).font = { bold: true };
    if (numFmt) row.getCell(2).numFmt = numFmt;
    row.getCell(2).alignment = { ...row.getCell(2).alignment, horizontal: hasRtlText(String(value ?? "")) ? "right" : "left" };
  }
  ws.getRow(2).getCell(2).font = { bold: true, size: 13 };

  if (result.optionDifferences.length > 0) {
    const warning = addRow(ws, columns, ["Options difference", "Warning: the runs used different validation options, so some changes may come from the options."]);
    tint(warning.getCell(1), WARNING_STYLE);
    tint(warning.getCell(2), WARNING_STYLE);
    for (const d of result.optionDifferences) {
      const row = addRow(ws, columns, [`  ${d.option}`, `${d.before} → ${d.after}`]);
      tint(row.getCell(2), WARNING_STYLE);
    }
  }
  for (const note of result.notes) addRow(ws, columns, ["Note", note]);
}

function pagesSheet(wb: ExcelJS.Workbook, result: CompareResult) {
  const columns: Column[] = [
    { header: "Page URL", width: 50 },
    { header: "Document", width: 50 },
    { header: "Type", width: 13 },
    { header: "Comparable", width: 20 },
    { header: "Score before", width: 13 },
    { header: "Score after", width: 12 },
    { header: "New", width: 8 },
    { header: "Fixed", width: 8 },
    { header: "Unchanged", width: 12 },
    { header: "Notes", width: 60, wrap: true },
  ];
  const ws = addTable(wb, "Pages", columns);
  for (const d of result.documents) {
    const compared = d.status === "compared";
    const notes = [d.reason, d.linkedFrom && d.linkedFrom > 1 ? `Linked from ${d.linkedFrom} pages; compared once` : undefined].filter(Boolean).join(" · ");
    const row = addRow(ws, columns, [
      d.pageUrl,
      d.document,
      ROLE_LABEL[d.role],
      compared ? "Yes" : DOCUMENT_STATUS_LABEL[d.status],
      d.scoreBefore,
      d.scoreAfter,
      compared ? d.new : undefined,
      compared ? d.fixed : undefined,
      compared ? d.unchanged : undefined,
      notes || undefined,
    ]);
    tint(row.getCell(4), compared ? CHECK_STYLE.pass : WARNING_STYLE);
    if (compared && d.new > 0) tint(row.getCell(7), CHANGE_STYLE.new);
    if (compared && d.fixed > 0) tint(row.getCell(8), CHANGE_STYLE.fixed);
  }
}

function issuesSheet(wb: ExcelJS.Workbook, result: CompareResult) {
  const columns: Column[] = [
    { header: "Issue ID", width: 14 },
    { header: "Page URL", width: 40 },
    { header: "Document", width: 40 },
    { header: "Change", width: 12 },
    { header: "Severity before", width: 15 },
    { header: "Severity after", width: 14 },
    { header: "Message", width: 60, wrap: true },
    { header: "Line", width: 7 },
    { header: "Extract", width: 50, wrap: true },
    { header: "Suggested fix", width: 50, wrap: true },
    { header: "Status", width: 12 },
    { header: "Notes", width: 40, wrap: true },
  ];
  const ws = addTable(wb, "Issues", columns);
  const issues = result.issues.slice(0, MAX_ISSUE_ROWS);
  for (const i of issues) {
    const row = addRow(ws, columns, [
      i.id,
      i.pageUrl,
      i.document,
      CHANGE_LABEL[i.change],
      i.severityBefore ? SEVERITY_LABEL[i.severityBefore] : undefined,
      i.severityAfter ? SEVERITY_LABEL[i.severityAfter] : undefined,
      i.message,
      i.line,
      i.extract,
      i.fix,
      i.change === "fixed" ? "Fixed" : "Open",
      undefined,
    ]);
    row.getCell(1).font = { name: "Consolas" };
    tint(row.getCell(4), CHANGE_STYLE[i.change]);
    if (i.severityBefore) tint(row.getCell(5), SEVERITY_STYLE[i.severityBefore]);
    if (i.severityAfter) tint(row.getCell(6), SEVERITY_STYLE[i.severityAfter]);
  }
  addStatusDropdown(ws, 11, issues.length);
  if (result.issues.length > MAX_ISSUE_ROWS) {
    addRow(ws, columns, [`The sheet lists the first ${MAX_ISSUE_ROWS.toLocaleString("en")} of ${result.issues.length.toLocaleString("en")} issues.`]);
  }
}

export async function renderCompareExcel(result: CompareResult, branding: CompareBranding): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = branding.preparedBy || "MarkupLens";
  wb.title = "MarkupLens run comparison";
  wb.subject = result.after.target;
  wb.created = new Date(result.generatedAt);
  infoSheet(wb, result, branding);
  pagesSheet(wb, result);
  issuesSheet(wb, result);
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
