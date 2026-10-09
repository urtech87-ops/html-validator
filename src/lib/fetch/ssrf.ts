import "server-only";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/**
 * SSRF protection for server-side URL fetches.
 *
 * Every address a host resolves to is classified:
 *   public           → always allowed
 *   private          → allowed only with ALLOW_PRIVATE_URLS=true
 *                      (loopback 127/8 + ::1, 10/8, 172.16/12, 192.168/16, fc00::/7)
 *   always-blocked   → never allowed, whatever the flag says: cloud metadata
 *                      (169.254.0.0/16, fd00:ec2::254), IPv6 link-local fe80::/10,
 *                      0.0.0.0/8, ::, and every other non-public range
 *                      (CGNAT, multicast, broadcast, reserved, …)
 * IPv4-mapped IPv6 addresses are classified as the IPv4 address they carry.
 * Known metadata hostnames are blocked before DNS is even consulted.
 *
 * Phase 7 adds DNS-rebinding protection (validating the address at connect time).
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

export type AddressClass = "public" | "private" | "always-blocked";

/** Ranges ALLOW_PRIVATE_URLS=true may unlock. Everything non-public outside this list stays blocked. */
const FLAG_ALLOWED_V4 = new Set(["loopback", "private"]);
const FLAG_ALLOWED_V6 = new Set(["loopback", "uniqueLocal"]);

/** Cloud metadata addresses inside otherwise flag-allowed ranges (AWS IMDS IPv6 sits in fc00::/7). */
const METADATA_V6 = [ipaddr.parse("fd00:ec2::254").toNormalizedString()];

/** Hostnames of cloud metadata services. Matched exactly or as a suffix (e.g. "x.metadata.google.internal"). */
export const METADATA_HOSTNAMES = [
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
  "metadata.ec2.internal",
  "metadata.azure.internal",
  "metadata.packet.net",
  "metadata.platformequinix.com",
  "metadata.tencentyun.com",
  "metadata.oraclecloud.com",
];

export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "").replace(/^\[|\]$/g, "");
}

export function isMetadataHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return METADATA_HOSTNAMES.some((m) => host === m || host.endsWith(`.${m}`));
}

/**
 * Parse an IP literal, including the legacy IPv4 forms the WHATWG URL parser
 * also accepts: a single decimal/hex/octal number ("2852039166", "0xA9FEA9FE")
 * and dotted forms with hex/octal parts ("0251.0376.0251.0376", "169.254.43518").
 * `new URL()` already canonicalises these; this is a second line of defence.
 */
export function parseIpLiteral(input: string): ipaddr.IPv4 | ipaddr.IPv6 | undefined {
  const host = normalizeHostname(input);
  if (ipaddr.IPv6.isValid(host)) return ipaddr.IPv6.parse(host);

  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4 || parts.some((p) => p === "")) return undefined;
  const nums: number[] = [];
  for (const part of parts) {
    let n: number;
    if (/^0x[0-9a-f]*$/i.test(part)) n = part.length === 2 ? 0 : parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
    else if (/^(0|[1-9]\d*)$/.test(part)) n = parseInt(part, 10);
    else return undefined;
    if (!Number.isFinite(n)) return undefined;
    nums.push(n);
  }
  // The last part fills the remaining bytes (inet_aton rules).
  const last = nums.pop()!;
  if (nums.some((n) => n > 255)) return undefined;
  const remainingBytes = 4 - nums.length;
  if (last >= 2 ** (8 * remainingBytes)) return undefined;
  const bytes = [...nums];
  for (let i = remainingBytes - 1; i >= 0; i--) bytes.push(Math.floor(last / 2 ** (8 * i)) % 256);
  return new ipaddr.IPv4(bytes);
}

export function classifyAddress(address: string): AddressClass {
  let ip = parseIpLiteral(address);
  if (!ip) return "always-blocked"; // unparseable → unsafe

  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  const range = ip.range();
  if (range === "unicast") return "public";

  if (ip.kind() === "ipv4") return FLAG_ALLOWED_V4.has(range) ? "private" : "always-blocked";

  if (METADATA_V6.includes((ip as ipaddr.IPv6).toNormalizedString())) return "always-blocked";
  return FLAG_ALLOWED_V6.has(range) ? "private" : "always-blocked";
}

/** True for anything that is not a public address (kept for callers that only need a yes/no). */
export function isPrivateAddress(address: string): boolean {
  return classifyAddress(address) !== "public";
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Inside Docker, "localhost" is the app container itself. Rewrite loopback
 * hosts to host.docker.internal so sites on the developer's machine (XAMPP)
 * remain reachable. Only applies when running in Docker. (0.0.0.0 is not
 * rewritten: it is always blocked.)
 */
export function rewriteLocalhostForDocker(url: URL, runningInDocker: boolean): URL {
  if (!runningInDocker) return url;
  const host = normalizeHostname(url.hostname);
  if (!LOCAL_HOSTNAMES.has(host) && !host.endsWith(".localhost")) return url;
  const rewritten = new URL(url.href);
  rewritten.hostname = "host.docker.internal";
  return rewritten;
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

export const METADATA_BLOCKED_MESSAGE = (host: string) =>
  `“${host}” is a cloud metadata or link-local address. MarkupLens never fetches these, even with ALLOW_PRIVATE_URLS=true.`;

/**
 * Throw BlockedUrlError unless the URL is http(s), its host is not a metadata
 * service, and every address it resolves to is allowed. Call it before the
 * first request and before every redirect hop.
 */
export async function assertUrlAllowed(
  url: URL,
  opts: { allowPrivateUrls: boolean; resolver?: Resolver; /** Host to name in errors (before the Docker rewrite). */ displayHost?: string },
): Promise<void> {
  const shown = opts.displayHost ?? url.hostname;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Only http and https URLs can be validated (got “${url.protocol.replace(/:$/, "")}”).`);
  }

  const host = normalizeHostname(url.hostname);
  if (isMetadataHostname(host)) throw new BlockedUrlError(METADATA_BLOCKED_MESSAGE(shown));

  let addresses: string[];
  const literal = parseIpLiteral(host);
  if (literal) {
    addresses = [literal.toString()];
  } else {
    try {
      addresses = await (opts.resolver ?? defaultResolver)(host);
    } catch {
      throw new BlockedUrlError(`Could not resolve host “${shown}”.`);
    }
  }
  if (addresses.length === 0) throw new BlockedUrlError(`Could not resolve host “${shown}”.`);

  const classes = addresses.map(classifyAddress);
  if (classes.includes("always-blocked")) {
    const blocked = addresses[classes.indexOf("always-blocked")];
    const ip = parseIpLiteral(blocked);
    const v4 = ip?.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress() ? (ip as ipaddr.IPv6).toIPv4Address() : ip;
    const range = v4?.range();
    const isMetadataRange = range === "linkLocal" || (v4?.kind() === "ipv6" && METADATA_V6.includes((v4 as ipaddr.IPv6).toNormalizedString()));
    if (isMetadataRange) throw new BlockedUrlError(METADATA_BLOCKED_MESSAGE(shown));
    throw new BlockedUrlError(
      `“${shown}” points to a reserved or non-routable address (${blocked}). MarkupLens never fetches these, even with ALLOW_PRIVATE_URLS=true.`,
    );
  }
  if (classes.includes("private") && !opts.allowPrivateUrls) {
    throw new BlockedUrlError(
      `“${shown}” points to a private or local network address, which is blocked. Set ALLOW_PRIVATE_URLS=true to allow it.`,
    );
  }
}
