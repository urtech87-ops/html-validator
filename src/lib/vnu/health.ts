/**
 * Health probe for the self-hosted Nu Html Checker (vnu).
 *
 * Sends a tiny, valid HTML5 document and checks that vnu answers with the
 * expected JSON shape (`{ messages: [...] }`). This proves the engine is not
 * only listening but actually validating.
 */

const PROBE_DOCUMENT =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>probe</title></head><body><p>ok</p></body></html>';

export interface VnuHealth {
  ok: boolean;
  url: string;
  latencyMs: number;
  /** Number of messages vnu returned for the probe (expected 0). */
  messageCount?: number;
  error?: string;
}

export async function checkVnuHealth(
  vnuUrl: string,
  timeoutMs = 5_000,
  fetchImpl: typeof fetch = fetch,
): Promise<VnuHealth> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  try {
    const res = await fetchImpl(`${vnuUrl}/?out=json`, {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: PROBE_DOCUMENT,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false, url: vnuUrl, latencyMs: elapsed(), error: `vnu responded with HTTP ${res.status}` };
    }

    const body: unknown = await res.json();
    const messages = (body as { messages?: unknown })?.messages;
    if (!Array.isArray(messages)) {
      return { ok: false, url: vnuUrl, latencyMs: elapsed(), error: "vnu response is missing the messages[] array" };
    }

    return { ok: true, url: vnuUrl, latencyMs: elapsed(), messageCount: messages.length };
  } catch (err) {
    const error =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
        ? `vnu did not respond within ${timeoutMs} ms`
        : `vnu is unreachable (${err instanceof Error ? err.message : String(err)})`;
    return { ok: false, url: vnuUrl, latencyMs: elapsed(), error };
  }
}
