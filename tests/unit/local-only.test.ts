import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hostnameOf, isLocalHost, isLocalOrigin, localOnly } from "@/lib/http/local-only";
import { config as proxyConfig, proxy } from "@/proxy";

const req = (headers: Record<string, string>, url = "http://127.0.0.1:3000/api/x") => new Request(url, { headers });

describe("localhost guard", () => {
  it("parses Host values with and without ports", () => {
    expect(hostnameOf("127.0.0.1:3000")).toBe("127.0.0.1");
    expect(hostnameOf("localhost:3000")).toBe("localhost");
    expect(hostnameOf("LOCALHOST")).toBe("localhost");
    expect(hostnameOf("[::1]:3000")).toBe("::1");
    expect(hostnameOf("[::1]")).toBe("::1");
    expect(hostnameOf("localhost.:3000")).toBe("localhost");
    expect(hostnameOf("")).toBeUndefined();
    expect(hostnameOf("[::1]junk")).toBeUndefined();
  });

  it("accepts only localhost, 127.0.0.1 and [::1] on any port", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000", "127.0.0.1", "localhost:8080"]) expect(isLocalHost(host), host).toBe(true);
    for (const host of [
      "evil.example",
      "evil.example:3000",
      "127.0.0.1.nip.io:3000",
      "localhost.evil.example",
      "192.168.1.10:3000",
      "0.0.0.0:3000",
      "app.localhost:3000",
      "[::ffff:127.0.0.1]:3000",
      null,
      undefined,
    ]) {
      expect(isLocalHost(host), String(host)).toBe(false);
    }
  });

  it("allows no Origin or a local one, refuses other sites and the opaque 'null' origin", () => {
    expect(isLocalOrigin(null)).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalOrigin("http://localhost:3000")).toBe(true);
    expect(isLocalOrigin("http://[::1]:3000")).toBe(true);
    expect(isLocalOrigin("https://evil.example")).toBe(false);
    expect(isLocalOrigin("null")).toBe(false);
    expect(isLocalOrigin("file://")).toBe(false);
  });

  it("wraps handlers: 403 before the handler runs for a foreign Host or Origin", async () => {
    let calls = 0;
    const handler = localOnly(async () => {
      calls++;
      return new Response("ok");
    });
    expect((await handler(req({ host: "127.0.0.1:3000" }), {})).status).toBe(200);
    expect((await handler(req({ host: "localhost:3000", origin: "http://localhost:3000" }), {})).status).toBe(200);
    expect((await handler(req({ host: "[::1]:3000" }), {})).status).toBe(200);
    const foreignHost = await handler(req({ host: "rebind.evil.example:3000" }), {});
    expect(foreignHost.status).toBe(403);
    expect(((await foreignHost.json()) as { error: string }).error).toMatch(/localhost/);
    expect((await handler(req({ host: "127.0.0.1:3000", origin: "https://evil.example" }), {})).status).toBe(403);
    expect(calls).toBe(3);
  });

  it("keeps the Docker healthcheck request working", async () => {
    // HEALTHCHECK runs fetch('http://127.0.0.1:3000/api/health') inside the container.
    const handler = localOnly(async () => new Response("ok"));
    expect((await handler(new Request("http://127.0.0.1:3000/api/health", { headers: { host: "127.0.0.1:3000" } }), {})).status).toBe(200);
  });

  it("proxy: pages refuse a foreign Host and let local ones through", async () => {
    const page = (host: string) => proxy(req({ host }, "http://127.0.0.1:3000/history") as never);
    expect(page("127.0.0.1:3000")).toBeUndefined();
    expect(page("localhost:3000")).toBeUndefined();
    expect(page("[::1]:3000")).toBeUndefined();
    const blocked = page("evil.example");
    expect(blocked?.status).toBe(403);
  });

  it("proxy matcher skips API routes (bodies would be buffered) and static assets", () => {
    const source = proxyConfig.matcher[0];
    // "/(<regex>)" → ^/<regex>$ (the matcher is a single path-to-regexp group).
    expect(source.startsWith("/(") && source.endsWith(")")).toBe(true);
    const re = new RegExp(`^/${source.slice(2, -1)}$`);
    for (const p of ["/", "/history", "/history/abc", "/bulk", "/api-docs"]) expect(re.test(p), p).toBe(true);
    for (const p of ["/api/validate", "/api/history/reports/x", "/_next/static/chunk.js", "/monaco/vs/loader.js", "/favicon.ico"]) {
      expect(re.test(p), p).toBe(false);
    }
  });
});

describe("every API route is wrapped in localOnly()", () => {
  const apiDir = path.resolve(import.meta.dirname, "../../src/app/api");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^route\.(ts|tsx|js)$/.test(entry.name)) routes.push(full);
    }
  };
  walk(apiDir);

  it("finds the API routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
  });

  it.each(routes.map((r) => [path.relative(apiDir, r), r]))("%s", (_name, file) => {
    const source = readFileSync(file, "utf8");
    const methods = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
    expect(methods.length, "exports at least one HTTP method").toBeGreaterThan(0);
    for (const method of methods) {
      expect(source, `${method} must be "export const ${method} = localOnly(...)"`).toMatch(new RegExp(`export const ${method} = localOnly\\(`));
    }
    expect(source).not.toMatch(/export\s+\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
  });
});
