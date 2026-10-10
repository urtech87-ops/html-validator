import { historyError, NO_STORE } from "@/lib/history/http";
import { deleteSavedReport, readSavedReport } from "@/lib/history/reports";
import { localOnly } from "@/lib/http/local-only";
import { contentDisposition } from "@/lib/report/filename";

/**
 * GET /api/history/reports/:id     → download a saved report again (the id from X-Report-Id).
 * DELETE /api/history/reports/:id  → delete it.
 */
export const GET = localOnly(async (_request: Request, { params }: RouteContext<"/api/history/reports/[id]">) => {
  const { id } = await params;
  try {
    const report = await readSavedReport(id);
    if (!report) return Response.json({ error: "Report not found." }, { status: 404 });
    return new Response(new Uint8Array(report.body), {
      headers: {
        "Content-Type": report.contentType,
        "Content-Disposition": contentDisposition(report.filename),
        "Content-Length": String(report.body.byteLength),
        "X-Report-Id": report.id,
        "X-Content-Type-Options": "nosniff",
        ...NO_STORE,
      },
    });
  } catch (err) {
    return historyError(err, "Loading the report");
  }
});

export const DELETE = localOnly(async (_request: Request, { params }: RouteContext<"/api/history/reports/[id]">) => {
  const { id } = await params;
  try {
    if (!(await deleteSavedReport(id))) return Response.json({ error: "Report not found." }, { status: 404 });
    return Response.json({ deleted: id }, { headers: NO_STORE });
  } catch (err) {
    return historyError(err, "Deleting the report");
  }
});
