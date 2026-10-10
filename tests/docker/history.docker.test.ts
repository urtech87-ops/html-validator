import { execFileSync, spawnSync } from "node:child_process";
import { request } from "node:http";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * History, the public API and the localhost guard in the Docker image:
 *
 *   docker compose up -d --build
 *   npm run test:docker
 */

const BASE = process.env.MARKUPLENS_URL ?? "http://127.0.0.1:3000";
const IMAGE = process.env.MARKUPLENS_IMAGE ?? "markuplens-app";
const CONTAINER = process.env.MARKUPLENS_CONTAINER ?? "markuplens-app-1";

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/health`).catch((err: unknown) => {
    throw new Error(`The Docker app isn't reachable at ${BASE} (${String(err)}). Start it with \`docker compose up -d --build\`.`);
  });
  expect(res.ok).toBe(true);
});

const json = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** fetch() can't override Host, so use node:http for the guard checks. */
function statusWithHost(path: string, host: string): Promise<number> {
  const url = new URL(path, BASE);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("history in the Docker image", () => {
  it("saves runs, saves reports of saved runs (X-Report-Id) and serves them again", async () => {
    const page = '<!DOCTYPE html><html lang="en"><head><title>Docker history test</title></head><body><main><h1>Hi</h1><center>old</center></main></body></html>';
    const first = (await (await json("/api/validate", { type: "html", value: page })).json()) as { runId: string; counts: { errors: number } };
    expect(first.runId).toMatch(/^[0-9a-f-]{36}$/);
    const second = (await (await json("/api/validate", { type: "html", value: page.replace("<center>old</center>", "") })).json()) as { runId: string };

    const report = await json("/api/report", { runId: second.runId, format: "xlsx", branding: { project: "Docker" } });
    expect(report.status).toBe(200);
    const reportId = report.headers.get("x-report-id")!;
    expect(reportId).toBeTruthy();
    const bytes = new Uint8Array(await report.arrayBuffer());
    const again = await fetch(`${BASE}/api/history/reports/${reportId}`);
    expect(again.status).toBe(200);
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(bytes);

    const saved = (await (await fetch(`${BASE}/api/history/${second.runId}`)).json()) as { reports: Array<{ id: string }> };
    expect(saved.reports.map((r) => r.id)).toContain(reportId);

    const comparison = (await (await fetch(`${BASE}/api/history/compare?a=${first.runId}&b=${second.runId}`)).json()) as { totals: { fixed: number } };
    expect(comparison.totals.fixed).toBeGreaterThan(0);

    // Stored on the volume: DATA_DIR/markuplens.db and DATA_DIR/reports/<runId>/.
    const files = execFileSync("docker", ["exec", CONTAINER, "sh", "-c", `ls /app/data && ls /app/data/reports/${second.runId}`], { encoding: "utf8" });
    expect(files).toContain("markuplens.db");
    expect(files).toContain(`${reportId}.xlsx`);
  });

  it("answers only local Host values; the healthcheck keeps working", async () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
      expect(await statusWithHost("/api/health", host), host).toBe(200);
      expect(await statusWithHost("/history", host), host).toBe(200);
    }
    expect(await statusWithHost("/api/health", "rebind.evil.example:3000")).toBe(403);
    expect(await statusWithHost("/history", "rebind.evil.example")).toBe(403);
    const cross = await fetch(`${BASE}/api/history`, { headers: { Origin: "https://evil.example" } });
    expect(cross.status).toBe(403);

    const health = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", CONTAINER], { encoding: "utf8" }).trim();
    expect(health).toBe("healthy");
  });

  it("the entrypoint stops with a clear message when the migration fails", () => {
    // /proc is not writable, so prisma migrate deploy can't create the database.
    const result = spawnSync("docker", ["run", "--rm", "--network", "none", "-e", "DATA_DIR=/proc/markuplens", IMAGE], { encoding: "utf8", timeout: 90_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/database migration failed, so the app was not started/);
    expect(result.stdout + result.stderr).not.toMatch(/Ready in/);
  });
});
