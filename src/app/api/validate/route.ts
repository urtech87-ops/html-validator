import { parseOptions } from "@/lib/validation/options";
import { validateText, validateUrl } from "@/lib/validation/run";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * POST /api/validate
 * Body: { type: "url" | "html" | "css", value: string, options?: ValidationOptions, fragment?: boolean }
 * Returns a normalised RunResult.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Request body must be JSON.");
  }

  const { type, value } = body;
  if (type !== "url" && type !== "html" && type !== "css") return bad('“type” must be "url", "html" or "css".');
  if (typeof value !== "string" || value.trim() === "") return bad("“value” must be a non-empty string.");
  const options = parseOptions(body.options);

  if (type === "url") {
    if (value.length > 2048) return bad("URL is too long (max 2048 characters).");
    return Response.json(await validateUrl(value, options));
  }

  if (new TextEncoder().encode(value).byteLength > MAX_TEXT_BYTES) return bad("Input is larger than 5 MB.", 413);
  return Response.json(await validateText(type, value, body.fragment === true, options));
}
