import "server-only";
import { RunCancelledError, withTimeout } from "@/lib/abort";

/** A message exactly as the Nu Html Checker returns it in `?out=json`. */
export interface VnuRawMessage {
  type: "error" | "info" | "non-document-error" | string;
  subType?: string;
  message?: string;
  extract?: string;
  firstLine?: number;
  lastLine?: number;
  firstColumn?: number;
  lastColumn?: number;
  hiliteStart?: number;
  hiliteLength?: number;
}

export interface VnuResponse {
  version?: string;
  messages: VnuRawMessage[];
  elapsedMs: number;
}

export class VnuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VnuError";
  }
}

export interface VnuRequest {
  body: Uint8Array | string;
  /** MIME type sent to vnu: text/html, application/xhtml+xml, text/css, image/svg+xml. */
  mediaType: string;
  /** Adds `; charset=…` (otherwise vnu detects the encoding itself, like validator.w3.org). */
  charset?: string;
}

/**
 * POST a document to the self-hosted vnu and return its JSON messages.
 * Never calls the public W3C services.
 */
export async function callVnu(
  vnuUrl: string,
  req: VnuRequest,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  /** Caller cancellation (bulk runs). Throws RunCancelledError when it fires. */
  signal?: AbortSignal,
): Promise<VnuResponse> {
  const started = performance.now();
  const contentType = req.charset ? `${req.mediaType}; charset=${req.charset}` : req.mediaType;

  let res: Response;
  try {
    res = await fetchImpl(`${vnuUrl}/?out=json`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: req.body as BodyInit,
      signal: withTimeout(timeoutMs, signal),
      cache: "no-store",
    });
  } catch (err) {
    if (signal?.aborted) throw new RunCancelledError();
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new VnuError(`The validation engine did not respond within ${Math.round(timeoutMs / 1000)} s.`);
    }
    throw new VnuError("The validation engine (vnu) is unreachable. Start it with: docker compose up -d vnu");
  }

  if (!res.ok) throw new VnuError(`The validation engine responded with HTTP ${res.status}.`);

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    if (signal?.aborted) throw new RunCancelledError();
    throw new VnuError("The validation engine returned invalid JSON.");
  }
  const messages = (json as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) throw new VnuError("The validation engine response has no messages[] array.");

  return {
    version: typeof (json as { version?: unknown }).version === "string" ? (json as { version: string }).version : undefined,
    messages: messages as VnuRawMessage[],
    elapsedMs: Math.round(performance.now() - started),
  };
}
