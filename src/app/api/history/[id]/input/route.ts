import { historyError, NO_STORE } from "@/lib/history/http";
import { loadRerunInput } from "@/lib/history/store";
import { localOnly } from "@/lib/http/local-only";

/** GET /api/history/:id/input → a bulk run's URLs, mode, concurrency and options, so /bulk can run it again. */
export const GET = localOnly(async (_request: Request, { params }: RouteContext<"/api/history/[id]/input">) => {
  const { id } = await params;
  try {
    const saved = await loadRerunInput(id);
    if (!saved || saved.input.type !== "bulk") return Response.json({ error: "No saved bulk run input with this id." }, { status: 404 });
    return Response.json({ ...saved.input, options: saved.options }, { headers: NO_STORE });
  } catch (err) {
    return historyError(err, "Loading the run input");
  }
});
