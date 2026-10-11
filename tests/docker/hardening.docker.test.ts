import { randomInt } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Phase 7 hardening in the Docker image, with the default limits from .env.example:
 *
 *   docker compose up -d --build
 *   npm run test:docker
 */

const BASE = process.env.MARKUPLENS_URL ?? "http://127.0.0.1:3000";

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/health`).catch((err: unknown) => {
    throw new Error(`The Docker app isn't reachable at ${BASE} (${String(err)}). Start it with \`docker compose up -d --build\`.`);
  });
  expect(res.ok).toBe(true);
});

/** A client address of our own (TEST-NET-2), so this test has a fresh per-client budget. */
const client = () => `198.51.100.${randomInt(1, 255)}`;

const post = (path: string, body: unknown, ip: string) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body) });

describe("hardening in the Docker image", () => {
  it("URL fetches go through the guarded agent (undici is in the standalone image)", async () => {
    // vnu's own start page, on the Compose network (private address, ALLOW_PRIVATE_URLS=true).
    const ok = await post("/api/validate", { type: "url", value: "http://vnu:8888/", save: false }, client());
    expect(ok.status).toBe(200);
    const run = (await ok.json()) as { documents: { fatal?: unknown; status?: number }[] };
    expect(run.documents[0].fatal).toBeUndefined();

    const metadata = await post("/api/validate", { type: "url", value: "http://169.254.169.254/latest/meta-data/", save: false }, client());
    const blocked = (await metadata.json()) as { documents?: { fatal?: { message?: string } }[]; error?: string };
    expect(JSON.stringify(blocked)).toMatch(/cloud metadata or link-local/);
  });

  it("answers 429 with Retry-After after 30 validations a minute from one client; health stays open", async () => {
    const ip = client();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await post("/api/validate", { type: "css", value: `a { color: red } /* ${i} */`, save: false }, ip);
      statuses.push(res.status);
      await res.body?.cancel();
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    const limited = await post("/api/validate", { type: "css", value: "a{}", save: false }, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await limited.json()) as { error: string }).error).toMatch(/at most 30 per minute/);
    expect((await fetch(`${BASE}/api/health`, { headers: { "X-Forwarded-For": ip } })).status).toBe(200);
  });

  it("refuses oversized request bodies with 413 before reading them", async () => {
    const res = await fetch(`${BASE}/api/sitemap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": client() },
      body: JSON.stringify({ url: "x".repeat(100 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it("sends the security headers", async () => {
    const page = await fetch(`${BASE}/`);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
