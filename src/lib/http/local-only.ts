/**
 * Localhost-only access. MarkupLens is a local tool (ports are published on
 * 127.0.0.1 only); checking the Host header also blocks DNS-rebinding pages
 * that point a hostile name at 127.0.0.1. API routes additionally reject
 * requests whose Origin is another site, so a web page can't drive the API
 * (run validations, read or delete history) from the user's browser.
 *
 * Pages are checked by src/proxy.ts; every API route handler is wrapped in
 * localOnly() (a unit test checks that none is missing).
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** Host name from a Host header value: "127.0.0.1:3000" → "127.0.0.1", "[::1]:3000" → "::1". */
export function hostnameOf(host: string | null | undefined): string | undefined {
  const value = (host ?? "").trim().toLowerCase();
  if (!value) return undefined;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return undefined;
    const rest = value.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return undefined;
    return value.slice(1, end);
  }
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(value);
  return match ? match[1].replace(/\.$/, "") : undefined;
}

export function isLocalHost(host: string | null | undefined): boolean {
  const name = hostnameOf(host);
  return name !== undefined && LOCAL_HOSTNAMES.has(name);
}

/** An Origin header is acceptable when absent or when it is http(s) on a local host. */
export function isLocalOrigin(origin: string | null | undefined): boolean {
  if (origin === null || origin === undefined || origin === "") return true;
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && isLocalHost(u.host);
  } catch {
    return false; // includes "null" (sandboxed iframes, file: pages)
  }
}

const MESSAGE = "MarkupLens only accepts requests to localhost, 127.0.0.1 or [::1].";

/** A 403 response when the request isn't local, else undefined. */
export function rejectNonLocal(request: Request, { checkOrigin }: { checkOrigin: boolean }): Response | undefined {
  if (!isLocalHost(request.headers.get("host"))) {
    return Response.json({ error: MESSAGE }, { status: 403 });
  }
  if (checkOrigin && !isLocalOrigin(request.headers.get("origin"))) {
    return Response.json({ error: "Cross-site requests to the MarkupLens API are not allowed." }, { status: 403 });
  }
  return undefined;
}

/** Wrap an API route handler so non-local requests get 403 before it runs. */
export function localOnly<Ctx = unknown>(handler: (request: Request, context: Ctx) => Response | Promise<Response>) {
  return async (request: Request, context: Ctx): Promise<Response> => rejectNonLocal(request, { checkOrigin: true }) ?? handler(request, context);
}
