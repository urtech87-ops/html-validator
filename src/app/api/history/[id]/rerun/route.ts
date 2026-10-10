import { historyError, NO_STORE } from "@/lib/history/http";
import { rerunSingle, RerunError } from "@/lib/history/rerun";
import { localOnly } from "@/lib/http/local-only";

/** POST /api/history/:id/rerun → validate the same input with the same options again; returns { runId } of the new run. */
export const POST = localOnly(async (_request: Request, { params }: RouteContext<"/api/history/[id]/rerun">) => {
  const { id } = await params;
  try {
    return Response.json({ runId: await rerunSingle(id) }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RerunError) return Response.json({ error: err.message }, { status: err.status });
    return historyError(err, "Re-running");
  }
});
