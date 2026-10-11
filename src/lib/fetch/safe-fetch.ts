import "server-only";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { RunCancelledError, throwIfCancelled, withTimeout } from "@/lib/abort";
import { assertUrlAllowed, BlockedUrlError, guardedLookup, rewriteLocalhostForDocker, type LookupAll, type Resolver } from "./ssrf";

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

export class FetchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchFailedError";
  }
}

export interface SafeFetchResult {
  /** The URL the user asked for (before any Docker rewrite). */
  requestedUrl: string;
  /** Final URL after redirects, as the user would see it. */
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string | null;
  bytes: Uint8Array;
  elapsedMs: number;
  redirects: string[];
}

export interface SafeFetchOptions {
  userAgent: string;
  allowPrivateUrls: boolean;
  runningInDocker: boolean;
  /** Accept header; defaults to HTML. */
  accept?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Replaces the network entirely (unit tests); skips the connect-time check. */
  fetchImpl?: typeof fetch;
  resolver?: Resolver;
  /** DNS lookup used when connecting (tests simulate DNS rebinding with it). */
  connectLookup?: LookupAll;
  /** Caller cancellation (bulk runs). Throws RunCancelledError when it fires. */
  signal?: AbortSignal;
}

export function parseUserUrl(input: string): URL {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    throw new BlockedUrlError(`“${input}” is not a valid URL.`);
  }
}

/** Undo the Docker rewrite for display, so users see the host they typed. */
function displayUrl(actual: URL, original: URL): string {
  if (actual.hostname === "host.docker.internal" && original.hostname !== "host.docker.internal") {
    const shown = new URL(actual.href);
    shown.hostname = original.hostname;
    return shown.href;
  }
  return actual.href;
}

/** One keep-alive pool per ALLOW_PRIVATE_URLS value; sockets only open to addresses guardedLookup allowed. */
const agents = new Map<boolean, Agent>();

function guardedAgent(allowPrivateUrls: boolean, lookupAll?: LookupAll): Agent {
  const make = () => new Agent({ connect: { lookup: guardedLookup({ allowPrivateUrls, lookupAll }) } });
  if (lookupAll) return make();
  let agent = agents.get(allowPrivateUrls);
  if (!agent) agents.set(allowPrivateUrls, (agent = make()));
  return agent;
}

/** undici's fetch with the guarded agent (Node's built-in fetch can't take a custom lookup). */
function guardedFetch(allowPrivateUrls: boolean, lookupAll?: LookupAll): typeof fetch {
  const dispatcher = guardedAgent(allowPrivateUrls, lookupAll);
  return ((url: URL, init: RequestInit) =>
    undiciFetch(url, { ...(init as UndiciRequestInit), dispatcher }) as unknown as Promise<Response>) as typeof fetch;
}

/** The BlockedUrlError raised by guardedLookup, if that is why the connection failed. */
function blockedCause(err: unknown): BlockedUrlError | undefined {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof BlockedUrlError) return e;
  }
  return undefined;
}

/**
 * Fetch a URL for validation:
 * - http(s) only, SSRF check before the first request and after every redirect
 * - the same check again on the addresses actually connected to (DNS rebinding)
 * - follows at most 5 redirects (manually, so each hop is checked)
 * - 15 s total timeout, 5 MB maximum body (streamed, aborted when exceeded)
 * - inside Docker, localhost/127.0.0.1 → host.docker.internal
 */
export async function safeFetch(input: string | URL, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const started = performance.now();
  const original = typeof input === "string" ? parseUserUrl(input) : input;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  const fetchImpl = opts.fetchImpl ?? guardedFetch(opts.allowPrivateUrls, opts.connectLookup);
  const signal = withTimeout(timeoutMs, opts.signal);
  const redirects: string[] = [];

  let current = rewriteLocalhostForDocker(original, opts.runningInDocker);

  for (let hop = 0; ; hop++) {
    throwIfCancelled(opts.signal);
    await assertUrlAllowed(current, {
      allowPrivateUrls: opts.allowPrivateUrls,
      resolver: opts.resolver,
      displayHost: new URL(displayUrl(current, original)).hostname,
    });

    let res: Response;
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        signal,
        cache: "no-store",
        headers: {
          "User-Agent": opts.userAgent,
          Accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en;q=0.9,*;q=0.5",
        },
      });
    } catch (err) {
      throwIfCancelled(opts.signal);
      const blocked = blockedCause(err);
      if (blocked) throw new BlockedUrlError(blocked.message);
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new FetchFailedError(`The page did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      throw new FetchFailedError(`Could not connect to ${current.host} (${describeNetworkError(err)}).`);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new FetchFailedError(`Too many redirects (more than ${MAX_REDIRECTS}).`);
      let next: URL;
      try {
        next = new URL(res.headers.get("location")!, current);
      } catch {
        throw new FetchFailedError("The page redirected to an invalid URL.");
      }
      redirects.push(displayUrl(next, original));
      current = rewriteLocalhostForDocker(next, opts.runningInDocker);
      continue;
    }

    const declaredLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await res.body?.cancel();
      throw new FetchFailedError(`The response is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
    }

    const bytes = await readLimited(res, maxBytes, timeoutMs, opts.signal);
    return {
      requestedUrl: original.href,
      finalUrl: displayUrl(current, original),
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get("content-type"),
      bytes,
      elapsedMs: Math.round(performance.now() - started),
      redirects,
    };
  }
}

const NETWORK_ERRORS: Record<string, string> = {
  ECONNREFUSED: "connection refused — is the server running?",
  ENOTFOUND: "host not found",
  EAI_AGAIN: "DNS lookup failed",
  ECONNRESET: "connection reset",
  ETIMEDOUT: "connection timed out",
  EHOSTUNREACH: "host unreachable",
  CERT_HAS_EXPIRED: "TLS certificate has expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: "self-signed TLS certificate",
  SELF_SIGNED_CERT_IN_CHAIN: "self-signed TLS certificate in chain",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate could not be verified",
  ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match the host name",
};

/** Turn undici's nested "fetch failed" errors into something readable. */
function describeNetworkError(err: unknown): string {
  let cause: unknown = err instanceof Error ? err.cause : undefined;
  if (cause instanceof AggregateError && cause.errors.length > 0) cause = cause.errors[0];
  const code = (cause as { code?: string } | undefined)?.code;
  if (code) return NETWORK_ERRORS[code] ?? code;
  if (cause instanceof Error && cause.message) return cause.message;
  return err instanceof Error ? err.message : String(err);
}

async function readLimited(res: Response, maxBytes: number, timeoutMs: number, cancel?: AbortSignal): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FetchFailedError(`The response is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof FetchFailedError) throw err;
    if (cancel?.aborted) throw new RunCancelledError();
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new FetchFailedError(`The page did not finish loading within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw new FetchFailedError("The connection was interrupted while reading the page.");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
