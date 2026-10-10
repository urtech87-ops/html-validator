import { randomUUID } from "node:crypto";
import { runBulk } from "@/lib/bulk/runner";
import { DEFAULT_CONCURRENCY, MAX_BULK_URLS, MAX_CONCURRENCY, type BulkEvent } from "@/lib/bulk/types";
import { parseUrlList } from "@/lib/bulk/url-list";
import { BulkRecorder, wantsSave } from "@/lib/history/store";
import { localOnly } from "@/lib/http/local-only";
import { parseOptions } from "@/lib/validation/options";

/**
 * POST /api/bulk
 * Body: { urls: string[], options?: ValidationOptions, concurrency?: number,
 *         mode?: "sitemap" | "url-list", sitemap?: string, save?: boolean }
 * Streams newline-delimited JSON (BulkEvent per line) as pages finish.
 * Aborting the request (closing the connection) cancels the run. The run is
 * saved to history as it goes (its id is in the "start" event), cancelled runs included.
 */
export const POST = localOnly(async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.urls) || body.urls.some((u) => typeof u !== "string")) {
    return Response.json({ error: "“urls” must be an array of strings." }, { status: 400 });
  }
  const parsed = parseUrlList((body.urls as string[]).join("\n"), Number.MAX_SAFE_INTEGER);
  if (parsed.urls.length === 0) return Response.json({ error: "No valid http(s) URLs were given." }, { status: 400 });
  if (parsed.urls.length > MAX_BULK_URLS) {
    return Response.json({ error: `Too many URLs: ${parsed.urls.length}. A bulk run is limited to ${MAX_BULK_URLS}.` }, { status: 400 });
  }
  const requested = Number(body.concurrency);
  const concurrency = Number.isInteger(requested) ? Math.min(MAX_CONCURRENCY, Math.max(1, requested)) : DEFAULT_CONCURRENCY;
  const options = parseOptions(body.options);
  const sitemap = typeof body.sitemap === "string" && body.sitemap.trim() ? body.sitemap.trim().slice(0, 2048) : undefined;
  const mode = body.mode === "sitemap" && sitemap ? "sitemap" : "url-list";

  let recorder: BulkRecorder | undefined;
  if (wantsSave(body.save)) {
    try {
      recorder = await BulkRecorder.start({ id: randomUUID(), urls: parsed.urls, options, concurrency, mode, target: mode === "sitemap" ? sitemap! : "URL list" });
    } catch (err) {
      console.error("Could not start saving the bulk run to history:", err);
    }
  }

  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      const send = (event: BulkEvent) => {
        if (controller.signal.aborted && event.type !== "end") return;
        try {
          streamController.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          controller.abort(); // client went away
        }
      };
      let end: Extract<BulkEvent, { type: "end" }> | undefined;
      const emit = (event: BulkEvent) => {
        recorder?.record(event);
        if (event.type === "start") send({ ...event, runId: recorder?.id });
        else if (event.type === "end") end = event; // sent once the run is saved
        else send(event);
      };
      runBulk(parsed.urls, options, concurrency, emit, controller.signal)
        // runBulk only throws on an unexpected bug; still end the stream cleanly.
        .catch(() => undefined)
        .then(async () => {
          const final = end ?? { type: "end" as const, cancelled: controller.signal.aborted, durationMs: 0 };
          await recorder?.finish(final.cancelled, final.durationMs);
          send({ ...final, runId: recorder?.id });
        })
        .finally(() => {
          try {
            streamController.close();
          } catch {
            // already closed by a cancelled client
          }
        });
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
