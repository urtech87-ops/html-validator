import { afterEach, describe, expect, it, vi } from "vitest";
import { localOnly } from "@/lib/http/local-only";
import {
  clientAddress,
  DEFAULT_RATE_LIMITS,
  RateLimiter,
  rateLimiter,
  rateLimitsFromEnv,
  tiersFor,
  tooManyRequests,
  type RateLimits,
} from "@/lib/http/rate-limit";

function limiter(patch: Partial<RateLimits> = {}) {
  let now = 1_000_000;
  const l = new RateLimiter(() => ({ ...DEFAULT_RATE_LIMITS, ...patch }), () => now);
  return { l, advance: (ms: number) => (now += ms) };
}

describe("tiersFor", () => {
  it.each([
    ["GET", "/api/health", []],
    ["POST", "/api/validate", ["work"]],
    ["POST", "/api/validate/upload", ["work"]],
    ["POST", "/api/sitemap", ["work"]],
    ["POST", "/api/bulk", ["work", "bulk"]],
    ["POST", "/api/report", ["work", "report"]],
    ["POST", "/api/history/abc/rerun", ["work"]],
    ["GET", "/api/history/compare", ["work"]],
    ["POST", "/api/history/compare", ["work"]],
    ["GET", "/api/history", ["read"]],
    ["DELETE", "/api/history", ["read"]],
    ["GET", "/api/history/abc", ["read"]],
    ["DELETE", "/api/history/abc", ["read"]],
    ["GET", "/api/history/abc/input", ["read"]],
    ["GET", "/api/history/reports/r1", ["read"]],
    ["DELETE", "/api/history/reports/r1", ["read"]],
    ["POST", "/api/something-new", ["work"]],
  ])("%s %s → %j", (method, path, tiers) => {
    expect(tiersFor(method, path)).toEqual(tiers);
  });
});

describe("RateLimiter", () => {
  it("allows 30 work requests per minute per client, then 429 until the window slides", () => {
    const { l, advance } = limiter();
    for (let i = 0; i < 30; i++) expect(l.check("1.2.3.4", ["work"]).ok, `request ${i + 1}`).toBe(true);
    const refused = l.check("1.2.3.4", ["work"]);
    expect(refused).toMatchObject({ ok: false, tier: "work", limit: 30 });
    expect(refused.retryAfter).toBe(60);
    // Another client has its own budget.
    expect(l.check("5.6.7.8", ["work"]).ok).toBe(true);
    advance(30_000);
    expect(l.check("1.2.3.4", ["work"]).retryAfter).toBe(30);
    advance(30_001);
    expect(l.check("1.2.3.4", ["work"]).ok).toBe(true);
  });

  it("refused requests are not counted", () => {
    const { l, advance } = limiter({ work: 2 });
    l.check("a", ["work"]);
    l.check("a", ["work"]);
    for (let i = 0; i < 10; i++) expect(l.check("a", ["work"]).ok).toBe(false);
    advance(60_001);
    expect(l.check("a", ["work"]).ok).toBe(true);
    expect(l.check("a", ["work"]).ok).toBe(true);
    expect(l.check("a", ["work"]).ok).toBe(false);
  });

  it("bulk and report have their own, tighter limits on top of work", () => {
    const { l } = limiter();
    for (let i = 0; i < 5; i++) expect(l.check("a", ["work", "bulk"]).ok).toBe(true);
    expect(l.check("a", ["work", "bulk"])).toMatchObject({ ok: false, tier: "bulk", limit: 5 });
    for (let i = 0; i < 10; i++) expect(l.check("a", ["work", "report"]).ok).toBe(true);
    expect(l.check("a", ["work", "report"])).toMatchObject({ ok: false, tier: "report", limit: 10 });
    // 15 work requests used so far: 15 more fit, then work is exhausted.
    for (let i = 0; i < 15; i++) expect(l.check("a", ["work"]).ok).toBe(true);
    expect(l.check("a", ["work"])).toMatchObject({ ok: false, tier: "work" });
  });

  it("reads have 120/min and don't use the work budget", () => {
    const { l } = limiter();
    for (let i = 0; i < 120; i++) expect(l.check("a", ["read"]).ok).toBe(true);
    expect(l.check("a", ["read"])).toMatchObject({ ok: false, tier: "read", limit: 120 });
    expect(l.check("a", ["work"]).ok).toBe(true);
  });

  it("the global cap stops a client that fakes a new address for every request", () => {
    const { l } = limiter();
    let accepted = 0;
    for (let i = 0; i < 1000; i++) if (l.check(`10.0.${i >> 8}.${i & 255}`, ["work"]).ok) accepted++;
    expect(accepted).toBe(240);
    expect(l.check("a-real-client", ["read"])).toMatchObject({ ok: false, tier: "global" });
  });

  it("unlimited requests (health) never count, and 0 or RATE_LIMIT_ENABLED=false disables limits", () => {
    const { l } = limiter({ work: 1 });
    for (let i = 0; i < 500; i++) expect(l.check("a", []).ok).toBe(true);
    const { l: off } = limiter({ enabled: false, work: 1 });
    for (let i = 0; i < 50; i++) expect(off.check("a", ["work"]).ok).toBe(true);
    const { l: zero } = limiter({ work: 0, global: 0 });
    for (let i = 0; i < 50; i++) expect(zero.check("a", ["work"]).ok).toBe(true);
  });

  it("at most 2 bulk runs at once; a slot is freed exactly once", () => {
    const { l } = limiter();
    const a = l.acquireBulkSlot();
    const b = l.acquireBulkSlot();
    expect(a && b).toBeTruthy();
    expect(l.acquireBulkSlot()).toBeUndefined();
    a!();
    a!(); // released twice: still counts once
    expect(l.runningBulk).toBe(1);
    const c = l.acquireBulkSlot();
    expect(c).toBeTruthy();
    expect(l.acquireBulkSlot()).toBeUndefined();
    b!();
    c!();
    expect(l.runningBulk).toBe(0);
  });
});

describe("configuration", () => {
  it("reads RATE_LIMIT_* with the documented defaults", () => {
    expect(rateLimitsFromEnv({} as NodeJS.ProcessEnv)).toEqual(DEFAULT_RATE_LIMITS);
    expect(DEFAULT_RATE_LIMITS).toEqual({ enabled: true, work: 30, bulk: 5, report: 10, read: 120, global: 240, bulkConcurrent: 2 });
    expect(
      rateLimitsFromEnv({
        RATE_LIMIT_ENABLED: "false",
        RATE_LIMIT_PER_MIN: "60",
        RATE_LIMIT_BULK_PER_MIN: "0",
        RATE_LIMIT_REPORT_PER_MIN: "x",
        RATE_LIMIT_READ_PER_MIN: "-3",
        RATE_LIMIT_GLOBAL_PER_MIN: "1000",
        RATE_LIMIT_BULK_CONCURRENT: "4",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ enabled: false, work: 60, bulk: 0, report: 10, read: 120, global: 1000, bulkConcurrent: 4 });
  });

  it("identifies the client by the first x-forwarded-for entry", () => {
    const r = (xff?: string) => new Request("http://127.0.0.1:3000/api/x", { headers: xff ? { "x-forwarded-for": xff } : {} });
    expect(clientAddress(r("127.0.0.1"))).toBe("127.0.0.1");
    expect(clientAddress(r("::ffff:172.17.0.1, 10.0.0.1"))).toBe("172.17.0.1");
    expect(clientAddress(r("::1"))).toBe("::1");
    expect(clientAddress(r())).toBe("unknown");
  });

  it("429 response has Retry-After and a readable message", async () => {
    const res = tooManyRequests({ ok: false, retryAfter: 12, tier: "report", limit: 10 });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(((await res.json()) as { error: string }).error).toBe("Too many reports: at most 10 per minute. Try again in 12 seconds.");
  });
});

describe("localOnly applies the limits", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers 429 before the handler runs, keeps /api/health unlimited", async () => {
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("RATE_LIMIT_PER_MIN", "3");
    let calls = 0;
    const handler = localOnly(async () => {
      calls++;
      return new Response("ok");
    });
    const req = (path: string, ip: string) =>
      new Request(`http://127.0.0.1:3000${path}`, { method: "POST", headers: { host: "127.0.0.1:3000", "x-forwarded-for": ip } });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await handler(req("/api/validate", "192.0.2.77"), {})).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(calls).toBe(3);
    for (let i = 0; i < 20; i++) expect((await handler(req("/api/health", "192.0.2.77"), {})).status).toBe(200);
    // A foreign Host is refused with 403 and doesn't use the budget.
    const foreign = new Request("http://127.0.0.1:3000/api/validate", { method: "POST", headers: { host: "evil.example", "x-forwarded-for": "192.0.2.78" } });
    expect((await handler(foreign, {})).status).toBe(403);
    expect((await handler(req("/api/validate", "192.0.2.78"), {})).status).toBe(200);
    expect(rateLimiter()).toBe(rateLimiter());
  });
});
