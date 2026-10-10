import { historyError, NO_STORE } from "@/lib/history/http";
import { deleteRuns, loadRun } from "@/lib/history/store";
import { localOnly } from "@/lib/http/local-only";

/**
 * GET /api/history/:id     → the saved run: summary, options, results, saved reports.
 * DELETE /api/history/:id  → delete it (a bulk run still in progress can't be deleted).
 */
export const GET = localOnly(async (_request: Request, { params }: RouteContext<"/api/history/[id]">) => {
  const { id } = await params;
  try {
    const run = await loadRun(id);
    if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
    return Response.json(run, { headers: NO_STORE });
  } catch (err) {
    return historyError(err, "Loading the run");
  }
});

export const DELETE = localOnly(async (_request: Request, { params }: RouteContext<"/api/history/[id]">) => {
  const { id } = await params;
  try {
    const deleted = await deleteRuns([id]);
    if (deleted.length === 0) return Response.json({ error: "Run not found, or still in progress." }, { status: 404 });
    return Response.json({ deleted }, { headers: NO_STORE });
  } catch (err) {
    return historyError(err, "Deleting the run");
  }
});
