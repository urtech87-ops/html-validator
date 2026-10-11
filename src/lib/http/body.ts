/**
 * Request bodies with a size cap. Route handlers have no body limit of their
 * own, and request.json() / formData() read everything before anything can be
 * checked, so bodies are read through this: a declared Content-Length over
 * the cap is refused straight away, and a body without one (chunked) is
 * stopped as soon as it passes the cap.
 */

const KB = 1024;
const MB = 1024 * KB;

export const BODY_LIMITS = {
  /** POST /api/validate: a 5 MB document, JSON-escaped (quotes, backslashes, control characters) + options. */
  validate: 12 * MB,
  /** POST /api/validate/upload: 20 files × 5 MB + multipart overhead + options. */
  upload: 101 * MB,
  /** POST /api/bulk: 200 URLs (≤ 2048 characters each) + options. */
  bulk: 2 * MB,
  /** POST /api/sitemap, POST /api/history/compare. */
  small: 64 * KB,
  /** DELETE /api/history: a list of run ids. */
  ids: 256 * KB,
} as const;

export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The request body is larger than ${formatLimit(maxBytes)}.`);
    this.name = "BodyTooLargeError";
  }
}

export class InvalidBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBodyError";
  }
}

function formatLimit(bytes: number): string {
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / KB)} KB`;
}

/** Read the whole body, refusing anything over maxBytes. */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Read and parse a JSON body (UTF-8), refusing anything over maxBytes. */
export async function readJsonLimited(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBodyLimited(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new InvalidBodyError("Request body must be JSON.");
  }
}

/** Read and parse a multipart/form-data body, refusing anything over maxBytes. */
export async function readFormLimited(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBodyLimited(request, maxBytes);
  const contentType = request.headers.get("content-type") ?? "";
  try {
    return await new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new InvalidBodyError("Expected multipart/form-data with one or more “files”.");
  }
}

/** 413 / 400 for the errors above; undefined for anything else. */
export function bodyErrorResponse(err: unknown): Response | undefined {
  if (err instanceof BodyTooLargeError) return Response.json({ error: err.message }, { status: 413 });
  if (err instanceof InvalidBodyError) return Response.json({ error: err.message }, { status: 400 });
  return undefined;
}
