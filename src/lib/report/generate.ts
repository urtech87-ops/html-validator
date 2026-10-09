import "server-only";
import { renderCsv } from "./csv";
import { renderExcel } from "./excel";
import { contentDisposition, reportFilename } from "./filename";
import { renderHtml } from "./html";
import { renderJson } from "./json";
import { PdfUnavailableError } from "./errors";
import { buildReportModel } from "./model";
import { FORMAT_META, type ReportRequest } from "./types";

/** Loaded on first use so the other formats keep working if Playwright can't load. */
async function loadPdf() {
  try {
    return await import("./pdf");
  } catch (err) {
    console.error("Could not load the PDF renderer:", err);
    throw new PdfUnavailableError("The PDF renderer could not be loaded. Other formats still work; see the server log.");
  }
}

export interface GeneratedReport {
  body: Uint8Array | string;
  filename: string;
  contentType: string;
}

export async function generateReport(request: ReportRequest, now = new Date()): Promise<GeneratedReport> {
  const model = buildReportModel(request, now);
  const filename = reportFilename(request.format, { project: request.branding.project, target: model.target, date: request.branding.reportDate });
  const contentType = FORMAT_META[request.format].mime;
  switch (request.format) {
    case "pdf":
      return { body: await (await loadPdf()).renderPdf(model), filename, contentType };
    case "xlsx":
      return { body: await renderExcel(model), filename, contentType };
    case "html":
      return { body: renderHtml(model), filename, contentType };
    case "json":
      return { body: renderJson(model), filename, contentType };
    case "csv":
      return { body: renderCsv(model), filename, contentType };
  }
}

export { contentDisposition };
