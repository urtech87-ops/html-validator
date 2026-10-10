import { renderCompareExcel } from "@/lib/history/compare-excel";
import { comparisonFilename, CompareError, loadComparison } from "@/lib/history/comparison";
import { historyError, NO_STORE } from "@/lib/history/http";
import { localOnly } from "@/lib/http/local-only";
import { contentDisposition } from "@/lib/report/filename";
import { FORMAT_META } from "@/lib/report/types";

/**
 * GET /api/history/compare?a=<id>&b=<id>          → the comparison as JSON (add &download=1 for a file).
 * POST /api/history/compare { a, b, format: "json" | "xlsx", branding? } → the comparison as a download.
 * The earlier run (by date) is always "before".
 */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function respond(a: string, b: string, format: "json" | "xlsx", download: boolean, branding: { project: string; preparedBy: string; reportDate: string }) {
  try {
    const result = await loadComparison(a, b);
    if (!result) return Response.json({ error: "One of the runs was not found." }, { status: 404 });
    if (format === "xlsx") {
      const body = await renderCompareExcel(result, branding);
      return new Response(body as Uint8Array<ArrayBuffer>, {
        headers: {
          "Content-Type": FORMAT_META.xlsx.mime,
          "Content-Disposition": contentDisposition(comparisonFilename(result, "xlsx", branding.reportDate)),
          "Content-Length": String(body.byteLength),
          ...NO_STORE,
        },
      });
    }
    const headers: Record<string, string> = { ...NO_STORE };
    if (download) headers["Content-Disposition"] = contentDisposition(comparisonFilename(result, "json", branding.reportDate));
    return Response.json(result, { headers });
  } catch (err) {
    if (err instanceof CompareError) return Response.json({ error: err.message }, { status: 400 });
    return historyError(err, "Comparing runs");
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export const GET = localOnly(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  return respond(params.get("a") ?? "", params.get("b") ?? "", "json", params.get("download") === "1", { project: "", preparedBy: "", reportDate: today() });
});

export const POST = localOnly(async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const format = body?.format === "xlsx" ? "xlsx" : body?.format === "json" ? "json" : undefined;
  if (!format) return Response.json({ error: "“format” must be \"json\" or \"xlsx\"." }, { status: 400 });
  const b = (body.branding && typeof body.branding === "object" ? body.branding : {}) as Record<string, unknown>;
  const date = str(b.reportDate, 10);
  return respond(str(body.a, 100), str(body.b, 100), format, true, {
    project: str(b.project, 120),
    preparedBy: str(b.preparedBy, 120),
    reportDate: /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : today(),
  });
});
