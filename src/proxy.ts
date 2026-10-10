import type { NextRequest } from "next/server";
import { isLocalHost } from "@/lib/http/local-only";

/**
 * Pages only: refuse requests whose Host isn't localhost / 127.0.0.1 / [::1]
 * (DNS rebinding). API routes are excluded here — Proxy buffers request bodies
 * (10 MB by default), which would cut off large uploads — and do the same
 * check, plus an Origin check, in their localOnly() wrapper.
 */
export function proxy(request: NextRequest) {
  if (isLocalHost(request.headers.get("host"))) return;
  return new Response("MarkupLens only accepts requests to localhost, 127.0.0.1 or [::1].", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/((?!api/|api$|_next/static|_next/image|monaco/|favicon.ico).*)"],
};
