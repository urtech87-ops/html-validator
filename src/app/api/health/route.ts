import { connection } from "next/server";
import pkg from "../../../../package.json";
import { getConfig } from "@/lib/config";
import { checkVnuHealth } from "@/lib/vnu/health";

/**
 * GET /api/health
 * 200 when the app and the vnu engine are both healthy, 503 otherwise.
 */
export async function GET() {
  await connection(); // always evaluate at request time, never prerender

  const config = getConfig();
  const vnu = await checkVnuHealth(config.vnuUrl, Math.min(config.vnuTimeoutMs, 5_000));

  return Response.json(
    {
      status: vnu.ok ? "ok" : "degraded",
      app: { name: "MarkupLens", version: pkg.version },
      vnu,
      allowPrivateUrls: config.allowPrivateUrls,
      checkedAt: new Date().toISOString(),
    },
    { status: vnu.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
