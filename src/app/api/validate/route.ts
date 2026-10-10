import { trySaveSingleRun, wantsSave } from "@/lib/history/store";
import { localOnly } from "@/lib/http/local-only";
import { parseOptions } from "@/lib/validation/options";
import { validateText, validateUrl } from "@/lib/validation/run";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * POST /api/validate
 * Body: { type: "url" | "html" | "css", value: string, options?: ValidationOptions, fragment?: boolean, save?: boolean }
 * Returns a normalised RunResult plus `runId` (the history id) unless `save: false`.
 */
export const POST = localOnly(async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Request body must be a JSON object.");

  const { type, value } = body;
  if (type !== "url" && type !== "html" && type !== "css") return bad("“type” must be \"url\", \"html\" or \"css\".");
  if (typeof value !== "string" || value.trim() === "") return bad("“value” must be a non-empty string.");
  const options = parseOptions(body.options);
  const save = wantsSave(body.save);

  if (type === "url") {
    if (value.length > 2048) return bad("URL is too long (max 2048 characters).");
    const run = await validateUrl(value, options);
    const saved = save ? await trySaveSingleRun(run, options, { type: "url", value: value.trim() }) : {};
    return Response.json({ ...run, ...saved });
  }

  if (new TextEncoder().encode(value).byteLength > MAX_TEXT_BYTES) return bad("Input is larger than 5 MB.", 413);
  const fragment = type === "html" && body.fragment === true;
  const run = await validateText(type, value, fragment, options);
  const saved = save ? await trySaveSingleRun(run, options, { type, value, fragment }) : {};
  return Response.json({ ...run, ...saved });
});
