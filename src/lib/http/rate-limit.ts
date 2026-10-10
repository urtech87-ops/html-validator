/**
 * Per-client rate limiting for /api/* (in memory: MarkupLens is one process).
 *
 * Tiers, each a sliding 60-second window, configurable with RATE_LIMIT_* (0 = no limit):
 *   work    30/min  validate, upload, sitemap, report, re-run, compare, bulk
 *   bulk     5/min  additionally for POST /api/bulk, plus at most 2 bulk runs at once
 *   report  10/min  additionally for POST /api/report
 *   read   120/min  other /api/history* requests (list, load, delete, saved report download)
 *   global 240/min  all limited requests from every client together
 * GET /api/health is never limited (Docker healthcheck, the UI's engine status).
 *
 * The client is identified by x-forwarded-for, which Next.js sets from the
 * socket address only when the request doesn't carry one, so a client can
 * fake it. The global cap bounds what faking it can achieve; MarkupLens only
 * accepts local requests anyway (see local-only.ts).
 */

export type Tier = "work" | "bulk" | "report" | "read";

export interface RateLimits {
  enabled: boolean;
  work: number;
  bulk: number;
  report: number;
  read: number;
  global: number;
  /** Bulk runs streaming at the same time (all clients). */
  bulkConcurrent: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { enabled: true, work: 30, bulk: 5, report: 10, read: 120, global: 240, bulkConcurrent: 2 };

function limit(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function rateLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimits {
  const d = DEFAULT_RATE_LIMITS;
  return {
    enabled: !["0", "false", "no", "off"].includes((env.RATE_LIMIT_ENABLED ?? "").trim().toLowerCase()),
    work: limit(env.RATE_LIMIT_PER_MIN, d.work),
    bulk: limit(env.RATE_LIMIT_BULK_PER_MIN, d.bulk),
    report: limit(env.RATE_LIMIT_REPORT_PER_MIN, d.report),
    read: limit(env.RATE_LIMIT_READ_PER_MIN, d.read),
    global: limit(env.RATE_LIMIT_GLOBAL_PER_MIN, d.global),
    bulkConcurrent: limit(env.RATE_LIMIT_BULK_CONCURRENT, d.bulkConcurrent),
  };
}

/** Which tiers a request counts against. [] = not limited. */
export function tiersFor(method: string, pathname: string): Tier[] {
  const p = pathname.replace(/\/+$/, "") || "/";
  const m = method.toUpperCase();
  if (p === "/api/health") return [];
  if (p === "/api/bulk") return ["work", "bulk"];
  if (p === "/api/report") return ["work", "report"];
  if (p === "/api/history/compare") return ["work"];
  if (/^\/api\/history\/[^/]+\/rerun$/.test(p)) return ["work"];
  if (p === "/api/history" || p.startsWith("/api/history/")) return m === "OPTIONS" ? [] : ["read"];
  return ["work"]; // validate, upload, sitemap and anything new
}

const WINDOW_MS = 60_000;
/** Above this many tracked clients the oldest are forgotten (faked addresses can't grow memory without bound). */
const MAX_TRACKED_KEYS = 10_000;

export interface LimitResult {
  ok: boolean;
  /** Seconds until a request would be accepted again (when !ok). */
  retryAfter: number;
  tier?: Tier | "global";
  limit?: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private bulkRunning = 0;

  constructor(
    private readonly limits: () => RateLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** Count the request against its tiers, or refuse it without counting. */
  check(client: string, tiers: Tier[]): LimitResult {
    const limits = this.limits();
    if (!limits.enabled || tiers.length === 0) return { ok: true, retryAfter: 0 };
    const now = this.now();
    const keys: { key: string; max: number; tier: Tier | "global" }[] = [
      ...tiers.map((tier) => ({ key: `${tier}|${client}`, max: limits[tier], tier })),
      { key: "global", max: limits.global, tier: "global" as const },
    ];
    for (const { key, max, tier } of keys) {
      if (max === 0) continue;
      const times = this.recent(key, now);
      if (times.length >= max) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000)), tier, limit: max };
      }
    }
    for (const { key, max } of keys) {
      if (max === 0) continue;
      this.recent(key, now).push(now);
    }
    this.prune();
    return { ok: true, retryAfter: 0 };
  }

  /** Reserve a bulk-run slot; call the returned function when the run ends. undefined = too many running. */
  acquireBulkSlot(): (() => void) | undefined {
    const limits = this.limits();
    if (limits.enabled && limits.bulkConcurrent > 0 && this.bulkRunning >= limits.bulkConcurrent) return undefined;
    this.bulkRunning++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.bulkRunning--;
    };
  }

  get runningBulk(): number {
    return this.bulkRunning;
  }

  private recent(key: string, now: number): number[] {
    let times = this.hits.get(key);
    if (!times) {
      times = [];
      this.hits.set(key, times);
    }
    while (times.length > 0 && times[0] <= now - WINDOW_MS) times.shift();
    return times;
  }

  private prune() {
    if (this.hits.size <= MAX_TRACKED_KEYS) return;
    const now = this.now();
    for (const [key, times] of this.hits) {
      if (times.length === 0 || times[times.length - 1] <= now - WINDOW_MS) this.hits.delete(key);
    }
    // Still too many: drop the oldest-inserted keys (Map keeps insertion order).
    for (const key of this.hits.keys()) {
      if (this.hits.size <= MAX_TRACKED_KEYS) break;
      if (key !== "global") this.hits.delete(key);
    }
  }
}

/** The client address Next.js put in x-forwarded-for (first entry), normalised. */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().toLowerCase();
  if (!forwarded) return "unknown";
  return forwarded.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "").slice(0, 64);
}

/** The process-wide limiter (survives Next.js dev reloads). */
const globalKey = Symbol.for("markuplens.rateLimiter");
export function rateLimiter(): RateLimiter {
  const g = globalThis as unknown as Record<symbol, RateLimiter | undefined>;
  return (g[globalKey] ??= new RateLimiter(() => rateLimitsFromEnv()));
}

const TIER_LABEL: Record<Tier | "global", string> = {
  work: "validation and report requests",
  bulk: "bulk runs",
  report: "reports",
  read: "history requests",
  global: "requests to MarkupLens",
};

export function tooManyRequests(result: LimitResult, message?: string): Response {
  const text =
    message ??
    `Too many ${TIER_LABEL[result.tier ?? "work"]}: at most ${result.limit} per minute. Try again in ${result.retryAfter} second${result.retryAfter === 1 ? "" : "s"}.`;
  return Response.json(
    { error: text },
    { status: 429, headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "no-store" } },
  );
}
