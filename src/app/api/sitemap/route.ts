import { getConfig } from "@/lib/config";
import { discoverSitemap } from "@/lib/bulk/sitemap";
import { BlockedUrlError } from "@/lib/fetch/ssrf";
import { USER_AGENTS, parseOptions } from "@/lib/validation/options";
import { localOnly } from "@/lib/http/local-only";

/**
 * POST /api/sitemap
 * Body: { url: string, options?: { userAgent } }
 * Finds and reads the site's sitemap(s) and returns the page URLs.
 */
export const POST = localOnly(async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body.url !== "string" || !body.url.trim()) return Response.json({ error: "“url” must be a non-empty string." }, { status: 400 });
  if (body.url.length > 2048) return Response.json({ error: "URL is too long (max 2048 characters)." }, { status: 400 });

  const config = getConfig();
  const options = parseOptions(body.options);
  try {
    const discovery = await discoverSitemap(body.url, {
      userAgent: USER_AGENTS[options.userAgent].value,
      allowPrivateUrls: config.allowPrivateUrls,
      runningInDocker: config.runningInDocker,
      signal: request.signal,
    });
    return Response.json(discovery);
  } catch (err) {
    if (err instanceof BlockedUrlError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
});
