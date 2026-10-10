import { historyError, NO_STORE } from "@/lib/history/http";
import { deleteRuns, listRuns } from "@/lib/history/store";
import { parseHistoryQuery } from "@/lib/history/types";
import { localOnly } from "@/lib/http/local-only";

/**
 * GET /api/history?q=&type=&result=&sort=&page=   → one page of saved runs (no results).
 * DELETE /api/history  { ids: string[] }          → delete runs (and their saved reports).
 */
export const GET = localOnly(async (request: Request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  try {
    return Response.json(await listRuns(parseHistoryQuery(params)), { headers: NO_STORE });
  } catch (err) {
    return historyError(err, "Listing history");
  }
});

export const DELETE = localOnly(async (request: Request) => {
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || ids.some((id) => typeof id !== "string")) {
    return Response.json({ error: "“ids” must be a non-empty array of run ids." }, { status: 400 });
  }
  try {
    return Response.json({ deleted: await deleteRuns(ids as string[]) }, { headers: NO_STORE });
  } catch (err) {
    return historyError(err, "Deleting runs");
  }
});
