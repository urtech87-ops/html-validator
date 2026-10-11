import { reportSourceFor, saveReport } from "@/lib/history/reports";
import { loadRun } from "@/lib/history/store";
import { BodyTooLargeError, readJsonLimited } from "@/lib/http/body";
import { localOnly } from "@/lib/http/local-only";
import { generateReport } from "@/lib/report/generate";
import { downloadHeaders } from "@/lib/report/filename";
import { PdfUnavailableError } from "@/lib/report/errors";
import { parseReportOptions, parseReportRequest, ReportRequestError } from "@/lib/report/request";
import { MAX_REPORT_REQUEST_BYTES, type ReportRequest } from "@/lib/report/types";

/**
 * POST /api/report
 * Body: { runId, format, contents?, branding? }
 * Renders a report for a saved run, saves the file to history (id in the
 * X-Report-Id header; download it again from GET /api/history/reports/:id)
 * and returns it as a download.
 *
 * The Phase 5 form with `source` (the results themselves) still works, but
 * the report is not saved.
 */
export const POST = localOnly(async (request: Request) => {
  let body: unknown;
  try {
    body = await readJsonLimited(request, MAX_REPORT_REQUEST_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return Response.json({ error: "The report request is too large." }, { status: 413 });
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    const runId = body && typeof body === "object" && typeof (body as { runId?: unknown }).runId === "string" ? (body as { runId: string }).runId : undefined;
    let parsed: ReportRequest;
    if (runId !== undefined) {
      const options = parseReportOptions(body);
      const saved = await loadRun(runId);
      if (!saved) return Response.json({ error: `No saved run with id “${runId}”.` }, { status: 404 });
      if (saved.summary.status === "running") return Response.json({ error: "The run is still in progress." }, { status: 409 });
      // Info messages default to the run's Verbose option, as in the report dialog.
      if (!(body as { contents?: { info?: unknown } }).contents || typeof (body as { contents: { info?: unknown } }).contents.info !== "boolean") {
        options.contents.info = saved.options.verbose;
      }
      parsed = { ...options, source: reportSourceFor(saved) };
    } else {
      parsed = parseReportRequest(body);
    }

    const report = await generateReport(parsed);
    const payload = typeof report.body === "string" ? new TextEncoder().encode(report.body) : report.body;
    const headers: Record<string, string> = {
      ...downloadHeaders(report.contentType, report.filename),
      "Content-Length": String(payload.byteLength),
      "Cache-Control": "no-store",
    };
    if (runId !== undefined) {
      try {
        const saved = await saveReport(runId, { ...report, body: payload }, parsed);
        if (saved.saved) headers["X-Report-Id"] = saved.id;
        else headers["X-Report-Not-Saved"] = saved.reason;
      } catch (err) {
        console.error("Saving the report to history failed:", err);
        headers["X-Report-Not-Saved"] = "The report could not be saved to history (see the server log).";
      }
    }
    return new Response(payload as Uint8Array<ArrayBuffer>, { headers });
  } catch (err) {
    if (err instanceof ReportRequestError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof PdfUnavailableError) return Response.json({ error: err.message }, { status: 503 });
    console.error("Report generation failed:", err);
    return Response.json({ error: "The report could not be generated." }, { status: 500 });
  }
});
