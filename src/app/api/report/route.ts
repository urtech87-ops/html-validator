import { contentDisposition, generateReport } from "@/lib/report/generate";
import { PdfUnavailableError } from "@/lib/report/errors";
import { parseReportRequest, ReportRequestError } from "@/lib/report/request";
import { MAX_REPORT_REQUEST_BYTES } from "@/lib/report/types";

/**
 * POST /api/report
 * Body: { format, contents, branding, source }
 *   source = { kind: "single", run } | { kind: "bulk", target, mode, pages, startedAt, cancelled }
 * Returns the report as a file download. Reports are generated on demand from
 * the run the browser holds; saving them to history arrives in Phase 6
 * (then `runId` replaces `source`).
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_REPORT_REQUEST_BYTES) return Response.json({ error: "The report request is too large." }, { status: 413 });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REPORT_REQUEST_BYTES) return Response.json({ error: "The report request is too large." }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    const report = await generateReport(parseReportRequest(body));
    const payload = typeof report.body === "string" ? new TextEncoder().encode(report.body) : report.body;
    return new Response(payload as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": report.contentType,
        "Content-Disposition": contentDisposition(report.filename),
        "Content-Length": String(payload.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof ReportRequestError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof PdfUnavailableError) return Response.json({ error: err.message }, { status: 503 });
    console.error("Report generation failed:", err);
    return Response.json({ error: "The report could not be generated." }, { status: 500 });
  }
}
