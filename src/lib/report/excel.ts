import "server-only";
import ExcelJS from "exceljs";
import { hasRtlText } from "@/lib/analysis/rtl";
import type { CheckStatus, Severity } from "@/lib/validation/types";
import { checkLogoDataUrl, imageSize } from "./logo";
import { CATEGORY_LABEL, ORIGIN_LABEL, SEVERITY_LABEL, STATUS_LABEL, type ReportModel } from "./model";
import { MAX_ISSUE_ROWS } from "./types";

/**
 * Excel workbook, five sheets: Report Info, Summary, Issues, Structure,
 * Issue Types. Every sheet has a frozen, filtered header row. Cells that
 * contain Arabic (or other RTL) text use right-to-left reading order.
 */

export const ISSUE_STATUSES = ["Open", "Fixed", "Won't fix"] as const;

/** Excel's cell limit is 32,767 characters. */
const MAX_CELL = 32_000;

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

const SEVERITY_STYLE: Record<Severity, { fill: string; font: string }> = {
  error: { fill: "FFFDE2E1", font: "FF991B1B" },
  warning: { fill: "FFFEF3C7", font: "FF92400E" },
  info: { fill: "FFDBEAFE", font: "FF1E40AF" },
};

const CHECK_STYLE: Record<CheckStatus, { fill: string; font: string }> = {
  pass: { fill: "FFDCFCE7", font: "FF166534" },
  warning: { fill: "FFFEF3C7", font: "FF92400E" },
  fail: { fill: "FFFDE2E1", font: "FF991B1B" },
};

type Cell = string | number | Date | undefined;

interface Column {
  header: string;
  width: number;
  /** Wrap long text. */
  wrap?: boolean;
  numFmt?: string;
}

function clip(value: Cell): Cell {
  return typeof value === "string" && value.length > MAX_CELL ? `${value.slice(0, MAX_CELL)}…` : value;
}

function tint(cell: ExcelJS.Cell, style: { fill: string; font: string }) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.fill } };
  cell.font = { ...cell.font, color: { argb: style.font }, bold: true };
}

/** Create a sheet with a styled, frozen, auto-filtered header row. */
function addTable(wb: ExcelJS.Workbook, name: string, columns: Column[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, xSplit: 0 }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  const header = ws.getRow(1);
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

/** Append a data row; wrap text where asked and switch Arabic/RTL cells to right-to-left reading order. */
function addRow(ws: ExcelJS.Worksheet, columns: Column[], values: Cell[]): ExcelJS.Row {
  const row = ws.addRow(values.map(clip));
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const column = columns[col - 1];
    const rtl = typeof cell.value === "string" && hasRtlText(cell.value);
    if (column?.wrap || rtl) {
      cell.alignment = {
        vertical: "top",
        wrapText: !!column?.wrap,
        ...(rtl ? { readingOrder: "rtl" as const, horizontal: "right" as const } : {}),
      };
    } else {
      cell.alignment = { vertical: "top" };
    }
  });
  return row;
}

const date = (iso: string | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso) : undefined);

/* ------------------------------------------------------------- the sheets */

function reportInfoSheet(wb: ExcelJS.Workbook, model: ReportModel) {
  const columns: Column[] = [
    { header: "Field", width: 28 },
    { header: "Value", width: 90, wrap: true },
  ];
  const ws = addTable(wb, "Report Info", columns);
  const b = model.branding;
  const c = model.contents;
  const included = [
    c.summary && "summary",
    c.errors && "errors",
    c.warnings && "warnings",
    c.info && "info",
    c.extracts && "source extracts",
    c.structure && "structure",
    c.outline && "outline",
    c.images && "image report",
  ].filter(Boolean);
  const rows: Array<[string, Cell, string?]> = [
    ["Report", "MarkupLens validation report"],
    ["Client / project", b.project || "—"],
    ["Prepared by", b.preparedBy || "—"],
    ["Report date", b.reportDate],
    ["Target", model.target || "—"],
    ["Input type", model.inputType],
    ["Run date", date(model.runDate), "yyyy-mm-dd hh:mm"],
    ["Generated", date(model.generatedAt), "yyyy-mm-dd hh:mm"],
    [model.kind === "bulk" ? "Pages checked" : "Documents checked", model.pageCount],
    ["Documents in report", model.documentCount],
    ["Passed (no errors)", model.passed],
    ["With errors", model.failed],
    ["Not validated", model.notValidated],
    ["Errors (total)", model.counts.errors],
    ["Warnings (total)", model.counts.warnings],
    ["Info (total)", model.counts.info],
    [model.kind === "bulk" ? "Average score" : "Score", model.averageScore ?? "—"],
  ];
  if (model.kind === "bulk") rows.push(["Site-wide score", model.siteScore ?? "—"]);
  rows.push(
    ["Score formula", "max(0, 100 − 5 × errors − 1 × warnings); info does not count"],
    ["Validation engine", model.engineVersion ? `Nu Html Checker ${model.engineVersion}` : "Nu Html Checker"],
    ["Contents included", included.join(", ")],
  );
  if (model.cancelled) rows.push(["Note", "The bulk run was cancelled before every page was checked."]);
  if (model.kind === "bulk") rows.push(["Note", "A stylesheet linked from many pages is listed and counted once."]);
  if (model.issueCount > MAX_ISSUE_ROWS) rows.push(["Note", `The Issues sheet lists the first ${MAX_ISSUE_ROWS.toLocaleString("en")} of ${model.issueCount.toLocaleString("en")} issues.`]);

  for (const [field, value, numFmt] of rows) {
    const row = addRow(ws, columns, [field, value]);
    row.getCell(1).font = { bold: true };
    if (numFmt) row.getCell(2).numFmt = numFmt;
    row.getCell(2).alignment = { ...row.getCell(2).alignment, horizontal: hasRtlText(String(value ?? "")) ? "right" : "left" };
  }
  ws.getRow(2).getCell(2).font = { bold: true, size: 13 };

  if (b.logo) {
    const logo = checkLogoDataUrl(b.logo);
    if (logo.ok && logo.type !== "image/webp") {
      const size = imageSize(logo.bytes, logo.type) ?? { width: 160, height: 80 };
      const scale = Math.min(1, 200 / size.width, 80 / size.height);
      const id = wb.addImage({ base64: logo.dataUrl, extension: logo.type === "image/png" ? "png" : "jpeg" });
      ws.getColumn(4).width = 30;
      ws.addImage(id, { tl: { col: 3.2, row: 1.2 }, ext: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) } });
    } else if (logo.ok) {
      addRow(ws, columns, ["Logo", "Not embedded: Excel can't show WebP images (it appears in the PDF and HTML reports)."]);
    }
  }
}

function summarySheet(wb: ExcelJS.Workbook, model: ReportModel) {
  const columns: Column[] = [
    { header: "#", width: 6 },
    { header: "Page URL", width: 50 },
    { header: "Document", width: 50 },
    { header: "Type", width: 13 },
    { header: "Status", width: 15 },
    { header: "Score", width: 8 },
    { header: "Errors", width: 9 },
    { header: "Warnings", width: 11 },
    { header: "Info", width: 8 },
    { header: "Structure fails", width: 15 },
    { header: "Structure warnings", width: 19 },
    { header: "HTTP status", width: 12 },
    { header: "Checked at", width: 18, numFmt: "yyyy-mm-dd hh:mm" },
    { header: "Notes", width: 50, wrap: true },
  ];
  const ws = addTable(wb, "Summary", columns);
  for (const d of model.documents) {
    const validated = !d.fatal;
    const notes = [d.fatal, d.linkedFrom && d.linkedFrom > 1 ? `Linked from ${d.linkedFrom} pages` : undefined, ...d.notices].filter(Boolean).join(" · ");
    const row = addRow(ws, columns, [
      d.pageIndex + 1,
      d.pageUrl,
      d.url ?? d.label,
      ORIGIN_LABEL[d.origin],
      STATUS_LABEL[d.status],
      d.score,
      validated ? d.counts.errors : undefined,
      validated ? d.counts.warnings : undefined,
      validated ? d.counts.info : undefined,
      d.structure?.counts.fail,
      d.structure?.counts.warning,
      d.httpStatus,
      date(d.checkedAt),
      notes || undefined,
    ]);
    const status = row.getCell(5);
    if (d.status === "passed") tint(status, CHECK_STYLE.pass);
    else tint(status, CHECK_STYLE.fail);
    if (validated && d.counts.errors > 0) tint(row.getCell(7), SEVERITY_STYLE.error);
    if (validated && d.counts.warnings > 0) tint(row.getCell(8), SEVERITY_STYLE.warning);
  }
}

function issuesSheet(wb: ExcelJS.Workbook, model: ReportModel) {
  const extracts = model.contents.extracts;
  const columns: Column[] = [
    { header: "Issue ID", width: 14 },
    { header: "Page URL", width: 40 },
    { header: "Document", width: 40 },
    { header: "Severity", width: 10 },
    { header: "Type", width: 10 },
    { header: "Message", width: 60, wrap: true },
    { header: "Line", width: 7 },
    { header: "Column", width: 8 },
    ...(extracts ? [{ header: "Extract", width: 50, wrap: true }] : []),
    { header: "Suggested fix", width: 50, wrap: true },
    { header: "Status", width: 12 },
    { header: "Notes", width: 40, wrap: true },
  ];
  const ws = addTable(wb, "Issues", columns);
  const severityCol = 4;
  const statusCol = columns.findIndex((c) => c.header === "Status") + 1;
  let rows = 0;
  documents: for (const d of model.documents) {
    for (const i of d.issues) {
      if (rows >= MAX_ISSUE_ROWS) break documents;
      rows++;
      const row = addRow(ws, columns, [
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
        "Open",
        undefined,
      ]);
      row.getCell(1).font = { name: "Consolas" };
      tint(row.getCell(severityCol), SEVERITY_STYLE[i.severity]);
    }
  }
  if (rows > 0) {
    const letter = ws.getColumn(statusCol).letter;
    // One range rule instead of one per cell; exceljs supports it but its typings omit `dataValidations`.
    const validations = (ws as unknown as { dataValidations: { add(range: string, rule: ExcelJS.DataValidation): void } }).dataValidations;
    validations.add(`${letter}2:${letter}${rows + 1}`, {
      type: "list",
      allowBlank: true,
      formulae: [`"${ISSUE_STATUSES.join(",")}"`],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "Status",
      error: `Choose ${ISSUE_STATUSES.join(", ")}.`,
    });
  }
}

function structureSheet(wb: ExcelJS.Workbook, model: ReportModel) {
  const columns: Column[] = [
    { header: "Page URL", width: 50 },
    { header: "Check", width: 26 },
    { header: "Status", width: 10 },
    { header: "Explanation", width: 70, wrap: true },
    { header: "Details", width: 50, wrap: true },
    { header: "Affected", width: 10 },
    { header: "Lines", width: 24, wrap: true },
  ];
  const ws = addTable(wb, "Structure", columns);
  if (!model.contents.structure) {
    addRow(ws, columns, ["Structure analysis was not included in this report."]);
    return;
  }
  for (const r of model.structureRows) {
    const row = addRow(ws, columns, [
      r.pageUrl,
      r.title,
      r.status === "pass" ? "Pass" : r.status === "warning" ? "Warning" : "Fail",
      r.explanation,
      r.details.join("\n") || undefined,
      r.affected ?? (r.lines.length || undefined),
      r.lines.join(", ") || undefined,
    ]);
    tint(row.getCell(3), CHECK_STYLE[r.status]);
  }
}

function issueTypesSheet(wb: ExcelJS.Workbook, model: ReportModel) {
  const columns: Column[] = [
    { header: "Message", width: 80, wrap: true },
    { header: "Severity", width: 10 },
    { header: "Type", width: 10 },
    { header: "Pages", width: 8 },
    { header: "Occurrences", width: 13 },
    { header: "Suggested fix", width: 60, wrap: true },
  ];
  const ws = addTable(wb, "Issue Types", columns);
  for (const t of model.issueTypes) {
    const row = addRow(ws, columns, [t.message, SEVERITY_LABEL[t.severity], CATEGORY_LABEL[t.category], t.pages, t.occurrences, t.fix]);
    tint(row.getCell(2), SEVERITY_STYLE[t.severity]);
  }
}

export async function renderExcel(model: ReportModel): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = model.branding.preparedBy || "MarkupLens";
  wb.title = "MarkupLens validation report";
  wb.subject = model.target;
  wb.created = new Date(model.generatedAt);
  reportInfoSheet(wb, model);
  summarySheet(wb, model);
  issuesSheet(wb, model);
  structureSheet(wb, model);
  issueTypesSheet(wb, model);
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
