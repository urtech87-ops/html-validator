import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeFetch, type SafeFetchOptions } from "@/lib/fetch/safe-fetch";
import { BLOCKED_ADDRESS_CODE, BlockedUrlError, guardedLookup, type LookupAll } from "@/lib/fetch/ssrf";

/**
 * DNS rebinding: the pre-check resolver says "public", the lookup used to
 * connect answers with a private / metadata address. These tests use real
 * sockets against a local server (no mocked fetch), so they exercise the
 * undici agent and its connect-time lookup.
 */

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>local</title>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const publicResolver = async () => ["93.184.215.14"];
const rebindTo = (address: string): LookupAll => async () => [{ address, family: address.includes(":") ? 6 : 4 }];

function opts(patch: Partial<SafeFetchOptions>): SafeFetchOptions {
  return { userAgent: "test-agent", allowPrivateUrls: false, runningInDocker: false, resolver: publicResolver, ...patch };
}

describe("connect-time address check (DNS rebinding)", () => {
  it("refuses to connect when the name rebinds to loopback after the check", async () => {
    const err = await safeFetch(`http://rebind.example:${port}/`, opts({ connectLookup: rebindTo("127.0.0.1") })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlockedUrlError);
    expect((err as Error).message).toMatch(/private or local network address/);
  });

  it("refuses metadata addresses at connect time even with ALLOW_PRIVATE_URLS=true", async () => {
    for (const address of ["169.254.169.254", "::ffff:169.254.169.254", "100.100.100.200", "0.0.0.0"]) {
      const err = await safeFetch(`http://rebind.example:${port}/`, opts({ allowPrivateUrls: true, connectLookup: rebindTo(address) })).catch(
        (e: unknown) => e,
      );
      expect(err, address).toBeInstanceOf(BlockedUrlError);
      expect((err as Error).message, address).toMatch(/cloud metadata or link-local|reserved or non-routable/);
    }
  });

  it("connects when the connect-time address is allowed", async () => {
    const res = await safeFetch(`http://rebind.example:${port}/`, opts({ allowPrivateUrls: true, connectLookup: rebindTo("127.0.0.1") }));
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(res.bytes)).toContain("<title>local</title>");
  });

  it("uses the guarded agent by default (real DNS for localhost)", async () => {
    const res = await safeFetch(`http://localhost:${port}/`, opts({ allowPrivateUrls: true, resolver: undefined }));
    expect(res.status).toBe(200);
    await expect(safeFetch(`http://localhost:${port}/`, opts({ resolver: undefined }))).rejects.toThrow(/private or local/);
  });
});

describe("guardedLookup", () => {
  const call = (lookup: ReturnType<typeof guardedLookup>, all: boolean) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address?: unknown; family?: number }>((resolve) =>
      lookup("host.example", { all }, (err, address, family) => resolve(err ? { err } : { err, address, family })),
    );

  it("returns one address or all of them, as net.connect asks", async () => {
    const lookup = guardedLookup({
      allowPrivateUrls: false,
      lookupAll: async () => [
        { address: "93.184.215.14", family: 4 },
        { address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", family: 6 },
      ],
    });
    expect(await call(lookup, false)).toEqual({ err: null, address: "93.184.215.14", family: 4 });
    expect((await call(lookup, true)).address).toHaveLength(2);
  });

  it("fails when any address is blocked, with a recognisable code", async () => {
    const lookup = guardedLookup({
      allowPrivateUrls: false,
      lookupAll: async () => [
        { address: "93.184.215.14", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    const { err } = await call(lookup, true);
    expect(err).toBeInstanceOf(BlockedUrlError);
    expect(err?.code).toBe(BLOCKED_ADDRESS_CODE);
  });

  it("passes DNS errors through", async () => {
    const lookup = guardedLookup({
      allowPrivateUrls: false,
      lookupAll: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND host.example"), { code: "ENOTFOUND" });
      },
    });
    expect((await call(lookup, false)).err?.code).toBe("ENOTFOUND");
  });
});
