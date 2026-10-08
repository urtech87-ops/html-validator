import "server-only";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/**
 * Basic SSRF protection for server-side URL fetches (Phase 2).
 * Phase 7 hardens this further (DNS-rebinding-safe connect, more tests).
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Ranges that are never public: loopback, private, link-local (incl. 169.254.169.254 metadata), ULA, etc. */
const BLOCKED_RANGES = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "carrierGradeNat",
  "private",
  "reserved",
  "uniqueLocal",
  "ipv4Mapped",
  "rfc6145",
  "rfc6052",
  "6to4",
  "teredo",
  "benchmarking",
  "amt",
  "as112",
  "as112v6",
  "orchid2",
  "droneRemoteIdProtocolEntityTags",
  "deprecated",
  "discard",
]);

export function isPrivateAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return true; // unparseable → treat as unsafe
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  return BLOCKED_RANGES.has(ip.range());
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/**
 * Inside Docker, "localhost" is the app container itself. Rewrite loopback
 * hosts to host.docker.internal so sites on the developer's machine (XAMPP)
 * remain reachable. Only applies when running in Docker.
 */
export function rewriteLocalhostForDocker(url: URL, runningInDocker: boolean): URL {
  if (!runningInDocker) return url;
  const host = url.hostname.toLowerCase();
  if (!LOCAL_HOSTNAMES.has(host) && !host.endsWith(".localhost")) return url;
  const rewritten = new URL(url.href);
  rewritten.hostname = "host.docker.internal";
  return rewritten;
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

/**
 * Throw BlockedUrlError unless the URL is http(s) and every address its host
 * resolves to is public (or private URLs are explicitly allowed).
 */
export async function assertUrlAllowed(
  url: URL,
  opts: { allowPrivateUrls: boolean; resolver?: Resolver },
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Only http and https URLs can be validated (got “${url.protocol.replace(/:$/, "")}”).`);
  }
  if (opts.allowPrivateUrls) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (ipaddr.isValid(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await (opts.resolver ?? defaultResolver)(host);
    } catch {
      throw new BlockedUrlError(`Could not resolve host “${url.hostname}”.`);
    }
  }
  if (addresses.length === 0) throw new BlockedUrlError(`Could not resolve host “${url.hostname}”.`);
  if (addresses.some(isPrivateAddress)) {
    throw new BlockedUrlError(
      `“${url.hostname}” points to a private or local network address, which is blocked. Set ALLOW_PRIVATE_URLS=true to allow it.`,
    );
  }
}
