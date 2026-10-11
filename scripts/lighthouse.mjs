#!/usr/bin/env node
/**
 * Lighthouse on MarkupLens itself (spec §6: Accessibility ≥ 95, Performance ≥ 85).
 *
 *   npm run lighthouse            (after `npm run build`; needs vnu and Chrome)
 *
 * Starts the production server from scripts/e2e-server.mjs (127.0.0.1:3100,
 * throwaway history in test-results/e2e/data), saves two small runs so the
 * saved-run and compare pages have content, then audits every page with the
 * mobile (default) and desktop presets, LH_RUNS times each (default 3; the
 * median run by performance score is reported, as Lighthouse recommends for
 * its run-to-run variance). Reports: test-results/lighthouse/ (median run per
 * page; every run's scores in runs.json).
 * Chrome is found by chrome-launcher (set CHROME_PATH to choose another);
 * its temporary profile goes to test-results/lighthouse/tmp, not C:\…\Temp.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "test-results", "lighthouse");
const tmpDir = path.join(outDir, "tmp");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });
// chrome-launcher creates its profile in os.tmpdir(); keep it on the project drive.
process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmpDir;

const { default: lighthouse, desktopConfig } = await import("lighthouse");
const chromeLauncher = await import("chrome-launcher");

const PORT = "3100";
const BASE = `http://127.0.0.1:${PORT}`;
const THRESHOLDS = { accessibility: 95, performance: 85 };
const RUNS = Math.max(1, Number(process.env.LH_RUNS) || 3);

const server = spawn(process.execPath, [path.join(root, "scripts", "e2e-server.mjs")], {
  cwd: root,
  env: { ...process.env, E2E_APP_PORT: PORT },
  stdio: ["ignore", "ignore", "inherit"],
});
const stop = () => {
  if (server.exitCode !== null || server.killed) return;
  // e2e-server.mjs starts `next start` as its own child: stop the whole tree.
  if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
  else server.kill();
};
process.on("exit", stop);

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The server did not start (is vnu running? did `npm run build` run?).");
}

async function seed() {
  const html = (n) =>
    `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Lighthouse sample page ${n}</title></head>\n<body>\n<main>\n<h1>Sample</h1>\n<h3>Skipped level</h3>\n<img src="a.png">\n<p id="x">a</p><p id="x">b</p>\n${n === 2 ? "<center>old</center>" : ""}\n</main>\n</body>\n</html>\n`;
  const ids = [];
  for (const n of [1, 2]) {
    const res = await fetch(`${BASE}/api/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "html", value: html(n) }),
    });
    if (!res.ok) throw new Error(`Seeding a run failed: HTTP ${res.status}`);
    ids.push((await res.json()).runId);
  }
  return ids;
}

const scores = [];
const allRuns = [];
try {
  await waitForServer();
  const [a, b] = await seed();
  const pages = [
    ["Validate (home)", "/"],
    ["Bulk", "/bulk"],
    ["History", "/history"],
    ["Saved run (results)", `/history/${b}`],
    ["Compare", `/history/compare?a=${a}&b=${b}`],
    ["API docs", "/api-docs"],
  ];

  for (const [preset, config] of [
    ["mobile", undefined],
    ["desktop", desktopConfig],
  ]) {
    for (const [name, route] of pages) {
      const results = [];
      for (let run = 0; run < RUNS; run++) {
        // A headless Chrome occasionally drops its DevTools connection: retry that run once.
        for (let attempt = 1; ; attempt++) {
          const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-first-run", "--disable-extensions"], userDataDir: false });
          try {
            results.push(
              await lighthouse(
                `${BASE}${route}`,
                { port: chrome.port, output: ["html", "json"], logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices"] },
                config,
              ),
            );
            break;
          } catch (err) {
            if (attempt >= 2) throw err;
            console.warn(`${preset} ${name}: Lighthouse run failed (${err instanceof Error ? err.message : err}), retrying.`);
          } finally {
            await chrome.kill();
          }
        }
      }
      results.sort((x, y) => x.lhr.categories.performance.score - y.lhr.categories.performance.score);
      for (const r of results) {
        const c = r.lhr.categories;
        allRuns.push({ preset, page: name, performance: Math.round(c.performance.score * 100), accessibility: Math.round(c.accessibility.score * 100) });
      }
      {
        const result = results[Math.floor(results.length / 2)];
        const slug = `${preset}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`;
        writeFileSync(path.join(outDir, `${slug}.html`), result.report[0]);
        writeFileSync(path.join(outDir, `${slug}.json`), result.report[1]);
        const c = result.lhr.categories;
        const failed = Object.values(result.lhr.audits)
          .filter((x) => x.score !== null && x.score < 1 && ["accessibility"].some((k) => c[k].auditRefs.some((r) => r.id === x.id && r.weight > 0)))
          .map((x) => x.id);
        scores.push({
          preset,
          page: name,
          performance: Math.round(c.performance.score * 100),
          accessibility: Math.round(c.accessibility.score * 100),
          bestPractices: Math.round(c["best-practices"].score * 100),
          lcpMs: Math.round(result.lhr.audits["largest-contentful-paint"].numericValue),
          tbtMs: Math.round(result.lhr.audits["total-blocking-time"].numericValue),
          cls: Number(result.lhr.audits["cumulative-layout-shift"].numericValue.toFixed(3)),
          a11yIssues: failed.join(", "),
          perfRange: `${allRuns.at(-results.length).performance}–${allRuns.at(-1).performance}`,
        });
      }
    }
  }
} finally {
  stop();
}

console.table(scores);
writeFileSync(path.join(outDir, "scores.json"), JSON.stringify(scores, null, 2));
writeFileSync(path.join(outDir, "runs.json"), JSON.stringify(allRuns, null, 2));
const misses = scores.filter((s) => s.accessibility < THRESHOLDS.accessibility || s.performance < THRESHOLDS.performance);
if (misses.length) {
  console.log(`\n${misses.length} of ${scores.length} audits are below Accessibility ${THRESHOLDS.accessibility} / Performance ${THRESHOLDS.performance}.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${scores.length} audits meet Accessibility ≥ ${THRESHOLDS.accessibility} and Performance ≥ ${THRESHOLDS.performance}.`);
}
console.log(`Reports: ${path.relative(root, outDir)}`);
