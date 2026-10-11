# MarkupLens — progress log

Status as of **2026-10-11**. Specification: [docs/SPEC.md](SPEC.md). Setup details: [README.md](../README.md).

Phases 1–6 are merged into `main` and pushed. **Phase 7 (`chore/hardening`) is complete on its branch and waits for the owner's "approved"** before it is merged and pushed.

## Phases

| # | Branch | Merge commit on `main` | Scope delivered |
|---|---|---|---|
| — | — | `f00ec4d` | Initial commit with `docs/SPEC.md` |
| 1 | `feat/foundation` | `fc58619` | Next.js 16.4 scaffold, Tailwind v4 + shadcn/ui, light/dark/system theme (no flash), `/api/health` probing vnu, docker-compose (app + vnu), Dockerfile, Vitest |
| 2 | `feat/validation-core` | `eeb58b5` | URL / multi-file upload / direct input (HTML/CSS, full/fragment), options panel, vnu client + normalisation, results UI (score, cards, filters, search, sort, grouping), Monaco source view, basic SSRF, Docker localhost rewrite, acceptance fixtures; SSRF fix for metadata + CGNAT |
| 3 | `feat/structure` | `808ae0b` | Structure & best-practice checks incl. lang/dir RTL, heading outline, image report, plain-English message guide (58 entries) |
| 4 | `feat/bulk` | `602182c` | Sitemap discovery + URL-list bulk runs, server-side queue with streaming progress, cancel, site summary, most common issues |
| 5 | `feat/reports` | `9eabe9b` | Report dialog, PDF (Playwright Chromium), Excel (5 sheets), HTML, JSON, CSV, branding + logo, Arabic/RTL support, Docker image with Noto Arabic fonts; `.claude/` excluded from git and the Docker build context |
| 6 | `feat/history-api` | `aee14e6` | Prisma + SQLite history (every run, bulk runs progressively), retention, `/history` (search, filters, sort, paging, delete, re-run, compare), saved reports, run comparison (+ JSON / Excel export), public API + `/api-docs`, localhost-only guard, `db:backup`, Docker migrations on start |
| 7 | `chore/hardening` | — (awaiting approval) | Connect-time SSRF check (DNS rebinding), tiered per-IP rate limits, request body caps, security headers, upload hardening, dependency audit fixes, Playwright e2e (56 tests, 1280/375 px × light/dark), Lighthouse script + fixes (accessibility 100), 375 px overflow fix, final README |

Branches are merged with `--no-ff`; nothing is merged into `main` or pushed without the owner's explicit "approved".

## Confirmed decisions

### Project-wide
- Local/internal tool for v1: no accounts, no public deployment. Ports are bound to `127.0.0.1` only.
- Stack as in the spec: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, npm (not pnpm).
- **Node 22 LTS**: `.nvmrc` = 22, `"engines": { "node": ">=22" }`, Docker base image `node:22-bookworm-slim`. Tooling: Vitest 5 / Vite 8.
- Never call validator.w3.org or jigsaw.w3.org — not from code, not during development.
- Phase workflow: one branch per phase, lint + typecheck + tests + build at the end, browser checks listed for the owner, then STOP until "approved".
- **No destructive commands on data without asking the owner first** (rule since 2026-10-10, after the Phase 6 volume wipe): no `rm -rf` on `data/`, `backups/` or volume contents, no `docker compose down -v`, `docker volume rm`, `docker volume prune` / `docker system prune`, no database resets or `prisma migrate reset`. Ask, wait for a yes, then run it.

### Phase 1 — foundation
- `ALLOW_PRIVATE_URLS=true` in `.env.example` (internal tool); the footer shows a "Private URLs allowed" notice while it is on.
- Inside Docker, `localhost` / `127.0.0.1` / `::1` / `*.localhost` are rewritten to `host.docker.internal` so XAMPP sites can be validated. Error messages show the host the user typed.
- `npm run dev` locally with only vnu in Docker; `docker compose up --build` for the full stack.

### Phase 2 — validation core
- **vnu pinned by digest** via `VNU_IMAGE`:
  `ghcr.io/validator/validator@sha256:0811ae47955ff59e52862df4b4d0cba90cd6fdaa62eefc2806aecb883556e616`
  (digest of `:latest` on 2026-10-09; reports version `26.10.7 (8049d4d)`). Fallback: `ghcr.io/validator/validator:24.10.17` (newest numbered image tag).
- vnu's document size limit raised to 6 MiB (`JAVA_TOOL_OPTIONS=-Dnu.validator.servlet.max-file-size=6291456`) so 5 MB inputs validate.
- **Acceptance fixtures** (`tests/fixtures/`, 3 known-bad HTML files): expected messages are recorded from the pinned local vnu (`npm run fixtures:update`), not from validator.w3.org. The owner cross-checked a snippet on validator.w3.org/nu manually.
- **CSS options** (no jigsaw in v1; the *Medium* option is hidden):
  - Warning level filters CSS-category messages: none = errors only · normal (default) = + warnings · more/all = + CSS info.
  - Vendor prefixes: **Ignore** (default) drops vnu messages about vendor-prefixed properties; **Treat as warnings** adds one MarkupLens warning per `-webkit-`/`-moz-`/`-ms-`/`-o-` property, labelled "MarkupLens check" (vnu itself accepts them silently).
- **Inline CSS:** no second pass. vnu validates `<style>` blocks and `style` attributes during the HTML pass; those messages are tagged CSS and the page shows the inline `<style>` block count. Linked stylesheets are validated as separate CSS documents.
- "Group by message type" (options) = "Group identical messages" (results). The "message type" filter = HTML / CSS / Document.
- **Limits:** upload ≤ 20 files, 5 MB each (`.html .htm .xhtml .css .svg`, extension + MIME + binary sniffing); ≤ 20 linked stylesheets per page; URL fetch ≤ 5 redirects, 15 s, 5 MB.
- **Score** = `max(0, 100 − 5 × errors − 1 × warnings)`; info doesn't count; pass = no errors.
- **Encoding:** BOM → HTTP header → `<meta>` / `@charset`; only a header charset or an override is forwarded to vnu.
- `POST /api/validate` and `POST /api/validate/upload` exist now (the UI needs them); documentation is Phase 6.
- **SSRF rules** (checked on the resolved IPs, on the first request and every redirect hop):

  | Destination | `ALLOW_PRIVATE_URLS=false` | `ALLOW_PRIVATE_URLS=true` |
  |---|---|---|
  | Public addresses | allowed | allowed |
  | Loopback (127/8, ::1), 10/8, 172.16/12, 192.168/16, **100.64/10 (CGNAT, e.g. Tailscale)**, fc00::/7, `host.docker.internal` | blocked | allowed |
  | Cloud metadata & link-local: 169.254.0.0/16, fe80::/10, **100.100.100.200 (Alibaba)**, **fd00:ec2::254 (AWS IPv6)**, hostnames `metadata`, `metadata.google.internal`, `instance-data`, … | **always blocked** | **always blocked** |
  | 0.0.0.0/8, ::, multicast, broadcast, other reserved ranges | **always blocked** | **always blocked** |

  IPv4-mapped IPv6 (`::ffff:169.254.169.254`) and decimal/hex/octal IPv4 forms (`2852039166`, `0xA9FEA9FE`, `0251.0376.0251.0376`) are recognised. Only http/https. `0.0.0.0` is never rewritten to `host.docker.internal`.

### Phase 3 — structure
- Thresholds: **RTL** "mostly right-to-left" at ≥ 50 % of letters with ≥ 20 RTL letters · **title** 10–60 characters · **meta description** 50–160 characters · **alt text** "very long" over 150 characters.
- Any inline `style` attribute → warning with the count. Landmarks: **only a missing `<main>` fails**; missing `<header>`/`<nav>`/`<footer>` warn.
- **Outline** and **Image report** are **on by default** (W3C defaults them off).
- Structure checks are **excluded from the score**.
- Direct-input fragments skip page-level checks (h1, landmarks, lang/RTL, title, meta, charset).
- The image report lists images as text only; images are never loaded.
- Message guide: 58 entries; unknown messages fall back to vnu's text.

### Phase 4 — bulk
- URL list ≤ **200** URLs per run (blank lines and `#` comments ignored, duplicates removed, invalid lines reported).
- Sitemap discovery: sitemap URL, or site root → `/sitemap.xml`, `/sitemap_index.xml`, then robots.txt `Sitemap:` lines; indexes followed up to depth 3 and 50 files; `.xml.gz` supported (gzip-bomb guarded); **up to 50,000 URLs listed**; first 200 pre-selected.
- Concurrency **1–6, default 3**, enforced on the server; results stream as NDJSON from `POST /api/bulk`.
- **Cancel** stops the queue and aborts in-flight fetches and vnu calls; leaving the page cancels too.
- No source view for documents **over 300 KB** in bulk runs.
- A stylesheet linked from many pages is fetched/validated **once per run** and **counted once in the site totals** (per-page numbers still include it).
- Saving bulk runs is **deferred to Phase 6** (history).

### Phase 5 — reports
- Built in a git worktree on `D:` on branch `feat/reports` (from `main` at `b63bbaa`); merged as `9eabe9b` after the owner's browser test (single-page Excel, Arabic PDF, bulk Excel/PDF totals, CSV in Excel, offline HTML, toggles, SVG rejection, stable Issue IDs). Compose project name stays `markuplens` (one stack, one `markuplens_markuplens-data` volume). The planning branch and the worktree were removed after the merge.
- **`.claude/` is excluded** from git (`.claude/*`, except the tracked `.claude/launch.json` preview config) and from the Docker build context (`.dockerignore`), so worktrees under `.claude/worktrees/` are never sent to `docker build`.
- **Reports on demand until Phase 6:** the browser POSTs the run it holds (`source`, document sources stripped) to `POST /api/report`; nothing is saved. Phase 6 adds history and `runId`.
- **Formats:** PDF = the HTML report printed by `playwright-core` Chromium headless shell (JS disabled, all network blocked, one shared browser, ≤ 2 renders at once, closed after 60 s idle). Excel via `exceljs`. HTML = one self-contained file with a strict CSP. JSON = report model, `version: 1`.
- **CSV = issues only**, UTF-8 **with BOM** (Excel shows Arabic correctly), CRLF, RFC 4180 quoting, and **formula protection**: cells starting with `= + - @` (or tab/CR) get a leading `'`.
- **Contents toggles:** all on by default, **info follows the run's Verbose option**. Totals/scores always describe the whole run; severity toggles only choose listed messages. Excel always has its 5 sheets.
- **PDF/HTML cap: 500 grouped messages per document**, with a note pointing to Excel/CSV/JSON; Excel/CSV list up to 200,000 issues; JSON everything.
- **Logo:** PNG/JPEG/WebP ≤ 1 MB, checked by magic bytes (the declared type is ignored); **SVG logos are rejected**. **A WebP logo is not embedded in Excel** (exceljs/Excel can't show it; Report Info says so); it appears in PDF and HTML.
- **PDF copy/paste caveat:** Chromium writes shaped Arabic in visual order (some ligatures stay logical), so copying or extracting Arabic text from a PDF can give reversed words; the PDF displays correctly.
- **Excel = 5 sheets:** Report Info (branding, logo, target, input type, run date, page count, totals, average score), Summary, Issues, Structure, Issue Types. Frozen + filtered headers on every sheet, severity colours, Status dropdown (Open / Fixed / Won't fix) + Notes column.
- **Issue ID** = first 10 hex of SHA-256(normalised document URL without fragment + "\n" + message + "\n" + whitespace-collapsed extract); no line numbers; duplicates in one document get `-2`, `-3`.
- **Arabic:** Docker image installs `fonts-noto-core` (Noto Sans Arabic / Noto Naskh Arabic) + `fonts-dejavu-core`; HTML/PDF font stacks fall back to them (Segoe UI / Tahoma on Windows). All user text is `dir="auto"` + `unicode-bidi: isolate`/`plaintext`; Arabic in code extracts uses a `unicode-range` alias to the Arabic font. Excel cells containing RTL letters get right-to-left reading order.
- Shared stylesheets in bulk reports are listed/counted once; documents that couldn't be validated show their reason as status and add no issues (matches the site totals).
- Pinned: `playwright-core@1.63.0`, `exceljs@4.4.0`, dev `pdfjs-dist@6.3.289` (newest releases ≥ 2 weeks old). Local Chromium: `npx playwright-core install --only-shell chromium` into `D:\ms-playwright` (documented in README first).

### Phase 6 — history & API
- Built in the git worktree `.claude/worktrees/phase-6-history-api-7c79e7` on branch `feat/history-api` (from `main` at `38925e1`; the main folder was switched back to `main` so the branch could be checked out there), committed in 7 logical commits and merged as **`aee14e6`** after the owner's browser test: fix-verification compare (fixed issues show as Fixed), comparison Excel and JSON, saved report re-download, bulk compare, cancelled bulk run in history and its re-run, history search / filter / sort / delete, history surviving a container restart, `/api-docs` with curl, phone width and dark mode. The Phase 6 worktree and the `claude/*` helper branches were removed after the merge.
- **All Phase 6 decisions below were accepted by the owner**, including the compaction threshold, the Origin check, cross-target compare with a warning, the *Document* column and no logo in the comparison Excel, the compact header on narrow screens, and the Prisma CLI audit findings parked in the Phase 7 backlog.
- **Prisma 7.10.0** (`prisma`, `@prisma/client`, `@prisma/adapter-better-sqlite3`, exact versions) with the `prisma-client` generator → `src/generated/prisma` (git-ignored; generated by `predev`, `prebuild`, `typecheck`, `pretest`). `prisma.config.ts` points at `DATA_DIR/markuplens.db`. One committed migration: `prisma/migrations/20261010000000_init`.
- **SQLite in WAL mode** (`synchronous=NORMAL`, `foreign_keys=ON`, 10 s busy timeout) at `DATA_DIR/markuplens.db`; saved report files at `DATA_DIR/reports/<runId>/<reportId>.<ext>`. `DATA_DIR` = `./data` for `npm run dev`, `/app/data` (the `markuplens-data` volume) in Docker (Compose sets it explicitly).
- Tables **Run** and **Report**. Results and the re-run input are **gzipped JSON** blobs; list columns (target, targetKey, status, score, counts, pages) are plain columns so the history table never decompresses results.
- **Every run is saved**: `/api/validate` and `/api/validate/upload` return `runId` (= the run's `id`; `save: false` skips). Bulk runs: the row is created at start (`runId` in the NDJSON `start` and `end` events), rewritten at most every 2 s and at the end, **cancelled runs included**; rows left `running` by a dead process are marked **interrupted** when the database is opened.
- **Saved sources:** at most **10 MB of document sources per run** (later ones marked `sourceOmitted`); bulk keeps its 300 KB per-document rule. A re-run input over 10 MB (big uploads) isn't kept → that run can't be re-run.
- **Retention:** `HISTORY_MAX_RUNS=500`, `HISTORY_MAX_MB=2048` (database blobs + report files), oldest runs (with reports) first, running runs never; **20 saved reports per run**, oldest first; a report **over 100 MB** is downloaded but not saved (`X-Report-Not-Saved`). After deletions the DB is compacted with `VACUUM` + WAL truncate **when ≥ 25 % of the file or ≥ 64 MB is free** (not on every single deletion: at the 500-run steady state that would VACUUM up to 2 GB per run).
- **Re-run** uses the saved input and options: single runs on the server (`POST /api/history/:id/rerun` → new run), bulk runs via `/bulk?rerun=<id>` with their URLs, options and concurrency.
- **Target keys** (for "compare with previous run"): `url:<normalised URL>`, `direct:html|css`, `upload:<sorted file names>`, bulk `site:<origin>` (sitemap origin, else the origin most URLs share).
- **Compare:** same `issueId()` and `-2`/`-3` suffixes as Excel (the report model's `toIssues` is reused); new / fixed / unchanged; severity changes noted; options difference listed (only options that change results: encoding, only-if-missing, error pages, verbose, User-Agent, CSS warning level, vendor prefixes); validator version change noted. Single runs document by document; bulk runs page by page (URL, fragment ignored) with added / removed / not comparable, **shared stylesheets compared and counted once** (attributed to the first page linking them). Runs of different kinds are refused; different targets are allowed with a warning. Earlier run is always "before".
- **Compare export:** JSON (`schema: "markuplens-compare"`, `version: 1`) and Excel (*Comparison Info*, *Pages*, *Issues*), reusing the report workbook's styling helpers (now exported from `excel.ts`). The Issues sheet also has a *Document* column (needed for stylesheets). Status defaults to *Fixed* for fixed issues, *Open* otherwise. Branding (project / prepared by) comes from the report dialog's saved prefs; no logo in the comparison workbook.
- **Reports:** `POST /api/report` with `runId` renders from the saved run and saves the file (`X-Report-Id`); `GET /api/history/reports/:id` serves it again; info messages default to the run's Verbose option. The Phase 5 `source` form still works, undocumented and not saved. The UI always uses `runId` when the run was saved.
- **Localhost only:** `next dev -H 127.0.0.1` / `next start -H 127.0.0.1`. Host must be `localhost`, `127.0.0.1` or `[::1]` (any port): `src/proxy.ts` for pages (API excluded — Proxy buffers bodies at 10 MB), `localOnly()` wrapper on **every** API route (unit test enforces it), which also refuses a non-local `Origin` (cross-site requests from a web page). The Docker healthcheck still passes.
- **Docker:** the deps stage copies the Prisma CLI and its locked dependency tree (`scripts/copy-prisma-cli.mjs`) into the runner; `docker-entrypoint.sh` runs the official `prisma migrate deploy`, then `exec node server.js`, and exits 1 with *"the database migration failed, so the app was not started"* if it fails. `openssl` added for the schema engine. Image **1.76 GB** (was ≈ 1.4 GB).
- File tracing: runtime paths built from `DATA_DIR` carry `/* turbopackIgnore: true */` (otherwise the standalone output pulled in `data/`, `src/`, `tests/`…). `outputFileTracingExcludes` was tried and dropped: its globs also matched folders inside `node_modules` (e.g. `fast-csv/build/src`, the Prisma runtime) and broke the container.
- **Backup / restore:** `npm run db:backup` uses SQLite's online backup (safe while the app runs) + copies `data/reports` into `backups/<local date_time>/` (git- and docker-ignored); restore = stop `npm run dev`, copy `markuplens.db` + `reports/` back into `data/`, delete any `-wal` / `-shm`. Docker volume: stop the app, `docker compose run --rm --no-deps -v ./backups:/backup --entrypoint sh app -c 'tar czf …'` with the app image itself (no extra image pulled), start it again; the archive name uses the container clock (UTC). Restore checks the archive with `tar tzf` **before** `find /app/data -mindepth 1 -delete` and `tar xzf`. **In Git Bash run `export MSYS_NO_PATHCONV=1` first**, otherwise `/backup` is rewritten to a Windows path and the archive isn't written. Exact commands are in the README ("Backing up history").
- Header: the wordmark hides below `sm` so four nav links (Validate, Bulk, History, API) fit at 375 px; `NavLinks` sits in `<Suspense>` (on dynamic routes `usePathname()` is runtime data under Cache Components).

### Phase 7 — hardening
- Built in the git worktree `.claude/worktrees/phase-7-hardening-review-836cb4` on branch `chore/hardening` (from `main` at `a908eb9`; the worktree had been created on the older `38925e1`, so the branch was made from `main` explicitly).
- **DNS rebinding:** `safeFetch` uses `undici` 7.30.0 (pinned, in `serverExternalPackages`) with an `Agent` whose `connect.lookup` (`guardedLookup` in `ssrf.ts`) resolves the host and applies the same rules (`assertAddressesAllowed`) to the addresses actually connected to. The pre-check stays for clear error messages. One keep-alive pool per `ALLOW_PRIVATE_URLS` value. IP-literal URLs don't use DNS, so the pre-check covers them. Tested with real sockets: pre-check resolver says public, connect lookup says 127.0.0.1 / 169.254.169.254 / ::ffff:169.254.169.254 / 100.100.100.200 / 0.0.0.0 → refused.
- **Rate limits** (owner's tiers; all `RATE_LIMIT_*`, `0` = unlimited, `RATE_LIMIT_ENABLED=false` = off): work 30/min per client (validate, upload, sitemap, report, re-run, compare GET/POST, bulk, and any new route by default); bulk +5/min and **at most 2 bulk runs streaming at once** (slot released when the stream ends, cancelled or not); report +10/min; other `/api/history*` 120/min; **global 240/min** over all clients; `GET /api/health` exempt. Sliding 60 s window, in memory (one process), applied in `localOnly()` *after* the Host/Origin check (refused foreign requests use no budget); refused requests don't count. Client = first `x-forwarded-for` entry (Next.js sets it from the socket only when absent, so it can be faked → the global cap), `::ffff:` stripped; at most 10,000 tracked clients. 429 JSON `{ error }` + `Retry-After`; the UI shows the message. Unit and integration test configs set `RATE_LIMIT_ENABLED=false`; the limits have their own unit, e2e and Docker tests.
- **Body caps** (`src/lib/http/body.ts`; a declared `Content-Length` over the cap is refused up front, chunked bodies are stopped at the cap; 413): validate 12 MB, upload 101 MB (parsed with `new Response(bytes).formData()` after the capped read), bulk 2 MB, sitemap/compare 64 KB, history delete 256 KB, report 60 MB (a chunked report request used to be read in full before the check).
- **Headers:** every response `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`; pages (not `/api`) `Content-Security-Policy: frame-ancestors 'none'` — a config-level CSP on `/api` *replaced* the routes' own CSP (found by e2e). HTML report downloads (new and saved) get `sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'` via `downloadHeaders()`.
- **Uploads:** MIME parameters accepted (`text/html; charset=utf-8`); added signatures: ZIP (empty/spanned), BZIP2 (`BZh` + digit only), XZ, Zstandard, OLE/Office, Java class, RIFF, TAR (`ustar` at 257).
- **No HTML from user content:** audited — only `theme-script.tsx` uses `dangerouslySetInnerHTML` (a constant); a unit test fails on any other use or DOM HTML sink; the e2e XSS probe validates a page with `<script>`, `onerror`, `<svg onload>`, `javascript:` and `srcdoc` and checks every tab and the HTML report.
- **Layout bug found by e2e:** at 375 px `/history` was 885 px wide: `sr-only` text and Radix's hidden checkbox inputs are `position: absolute` and escaped the unpositioned `overflow-x-auto` wrapper. All horizontal scroll containers are now `relative`.
- **Accessibility fixes from Lighthouse:** light-mode `--destructive` is Tailwind red-700 (`oklch(0.505 0.213 27.518)`) instead of red-600 — red text on its own 10 % tint was 3.95–4.09:1; the compare page's filter tabs now control a real `TabsContent` (dangling `aria-controls`).
- **Performance:** the results view and report dialog load on demand on Validate and Bulk (`src/components/results/lazy.tsx`, preloaded when a run starts; the results heading still gets focus). Not preloading Geist Mono was tried and reverted (CLS 0.078 on `/api-docs`).
- **E2E:** `@playwright/test` 1.63.0 (same browser revision as `playwright-core`: the headless shell in `D:\ms-playwright`). `npm run test:e2e` = build + `playwright test`; server `scripts/e2e-server.mjs` = `next start` on 127.0.0.1:3100 with `DATA_DIR=test-results/e2e/data` (recreated each run; never `./data` or the volume), global cap and concurrent-bulk limit off, per-client limits at their defaults (each test sends its own `x-forwarded-for`); fixture site `tests/e2e/site/server.mjs` on 127.0.0.1:3199. Four projects (desktop 1280 / phone 375 × light / dark); every test checks the theme class and that there is no horizontal scroll. `next start` prints a harmless warning about `output: standalone`.
- **Lighthouse:** `lighthouse` 13.5.0 (pinned dev dependency); `npm run lighthouse` = `scripts/lighthouse.mjs`: same throwaway server, seeds two runs, 6 pages × mobile + desktop presets × 3 runs, median reported (Lighthouse's own advice for its run-to-run variance; every run in `runs.json`), installed Chrome via chrome-launcher, temp profile in `test-results/lighthouse/tmp`, a crashed Chrome run retried once.
- **Windows sleep:** a first e2e run "took" 4.3 h and failed with `net::ERR_NETWORK_IO_SUSPENDED` because the machine slept; keep it awake during long runs.

## Dependencies (npm audit)

Phase 7 changes: `shadcn` moved to devDependencies (only `@import "shadcn/tailwind.css"` is used, compiled at build time); npm `overrides`: `exceljs` → `uuid@11.1.1`, `mysql2@3.24.4`, `deepmerge-ts@8.0.2` (kept because unit, integration, e2e and Docker tests — including `prisma migrate deploy` on container start — pass). Never `npm audit fix --force`.

| Finding | Severity | In the production image? | Status |
|---|---|---|---|
| `braces` ≤ 3.0.3 via `micromatch` → `fast-glob` in `eslint-config-next` and the shadcn CLI (9 packages flagged) | high | **No** (dev tools only now that `shadcn` is a devDependency; not in the standalone output) | **Accepted.** No fixed `braces` release exists (3.0.3 is the latest). |
| `uuid` < 11.1.1 via `exceljs@4.4.0` | moderate | yes | **Fixed** by override (`uuid@11.1.1`); exceljs 4.4.0 is the latest release. |
| `mysql2` ≤ 3.23 via `prisma` | high | yes (Prisma CLI for `migrate deploy`; never connects to MySQL) | **Fixed** by override (`3.24.4`). |
| `deepmerge-ts` < 8 via `@prisma/config` | high | yes (Prisma CLI) | **Fixed** by override (`8.0.2`). |
| `dompurify` ≤ 3.4.15 via `monaco-editor@0.57.0` (2 advisories, both need `IN_PLACE`) | low | yes (browser) | **Accepted.** Monaco's `min/` build, which the app serves, bundles its own DOMPurify copy, so an override would only silence the audit; Monaco never calls it with `IN_PLACE` (checked in the bundle); 0.57.0 is the latest Monaco. |

Totals: before Phase 7 **17** (2 low, 2 moderate, 13 high; `--omit=dev` 15). After Phase 7: **11** (2 low dompurify/monaco, 9 high braces chain, dev-only); `npm audit --omit=dev`: **2 low** (dompurify/monaco). Checked in the built image: `braces`, `micromatch`, `fast-glob`, `shadcn` absent; `undici` 7.30.0, `uuid` 11.1.1, `mysql2` 3.24.4, `deepmerge-ts` 8.0.2 present.

## Machine rules (C: drive is nearly full)

C: filled up on 2026-10-09 and corrupted Docker Desktop's storage (read-only file system, I/O errors, an app image with a 0-byte `package.json`). Since then:

- **Docker Desktop disk image:** `D:\DockerData` (Settings → Resources → Advanced → Disk image location).
- **npm cache:** `D:\npm-cache` (`npm config set cache D:\npm-cache`).
- **Playwright browsers:** `PLAYWRIGHT_BROWSERS_PATH=D:\ms-playwright` is set as a Windows user environment variable (documented in the README). The Chromium headless shell for reports is installed there (`chromium_headless_shell-1243`). Processes started before the variable existed (e.g. an old Claude session) don't see it — set `$env:PLAYWRIGHT_BROWSERS_PATH` in that shell.
- Keep temp output, test artifacts and caches **inside the project on D:** (e.g. git-ignored `test-results/`), not in C: temp folders.
- **Before any large build or pull** (`docker compose up --build`, image pulls, browser installs): check C: free space and **stop if it is under 3 GB**.

## Known issues and notes

- **Mobile Lighthouse performance** is below 85 on some pages (see "How to test"); desktop is 99–100 and accessibility 100 everywhere.
- **Rate limits** are in memory and per process (reset on restart); `x-forwarded-for` can be faked, bounded by the global cap.
- **vnu CSS checker** reports internal errors such as `Cannot invoke "org.w3c.css.values.CssValue.getType()"` on some modern CSS (custom properties). The guide explains them; they can be hidden with a message filter.
- Four rare vnu message kinds have no guide entry (about 2 % of distinct messages on a sample of real sites).
- Sitemap listing stops at 50,000 URLs; very large sites may be truncated (sitemap order).
- **Docker volume wiped once during Phase 6 testing (2026-10-10):** testing the restore command from Git Bash, MSYS path conversion broke the `/backup` mount, the archive wasn't written, and `rm -rf /app/data/*` ran before `tar` failed. The volume only held test runs from that day. The README's restore command now checks the archive before deleting and warns about `MSYS_NO_PATHCONV=1`.
- History lives on one machine only (no sync); back it up with `npm run db:backup` or the Docker `tar` commands in the README.
- Git Bash: export `MSYS_NO_PATHCONV=1` before `docker … -v ./x:/y` commands, or paths like `/backup` are rewritten to Windows paths.
- **One dev server per project:** Next.js refuses a second `next dev` in the same folder. The Docker app and `npm run dev` both use port 3000 — stop one before starting the other (`docker compose stop app`). Both listen on `127.0.0.1` since Phase 6; use http://127.0.0.1:3000.
- If the app container crash-loops after disk problems (e.g. `Invalid package config /app/package.json`), rebuild without cache: `docker compose build --no-cache app`.
- When testing the API from Git Bash, pass non-ASCII (e.g. Arabic) request bodies from a UTF-8 file (`--data-binary @file.json`); command-line arguments get mangled by the console code page.
- `C:\Users\HP\AppData\Local\ms-playwright` (≈ 1.6 GB) belongs to the Playwright browser tool used for testing, not to this project.
- The app image is ≈ 1.76 GB since Phase 6 (Chromium headless shell + Noto fonts + Prisma CLI).
- Chromium writes shaped Arabic into PDFs in visual order (some ligatures stay logical), so copy/paste or text extraction from a PDF can show Arabic words reversed; the PDF *displays* correctly. The tests compare Arabic as contiguous letter runs for this reason.

## Backlog after v1

- A Monaco release without the vulnerable DOMPurify copy (re-run `npm audit`).
- `braces`: drop the accepted finding once `eslint-config-next` / shadcn ship a fixed `fast-glob` chain.
- Prisma 8 (a release candidate today): remove the `mysql2` / `deepmerge-ts` overrides if it no longer needs them.
- Mobile performance: the remaining cost is mostly React/Next.js hydration under Lighthouse's 4× CPU slowdown.

## How to run

```bash
cp .env.example .env
npm install
docker compose up -d vnu   # vnu only
npm run dev                # applies migrations; http://127.0.0.1:3000
```

Full stack in Docker (stop `npm run dev` first; check C: free space ≥ 3 GB; migrations run on start):

```bash
docker compose up --build  # http://127.0.0.1:3000
```

## How to test

| Command | What it runs | Last result (Phase 7) |
|---|---|---|
| `npm run lint` | ESLint (`test-results/` ignored: the Playwright report bundles its own JS) | clean |
| `npm run typecheck` | `prisma generate` + `next typegen` + `tsc` | clean |
| `npm test` | Vitest unit tests (incl. report model, Issue IDs, CSV, Excel read-back, HTML, logo, dialog; **Phase 6:** localhost guard + "every API route wrapped" check, compare logic + comparison Excel read-back, history store / retention / compaction / report API against throwaway SQLite databases; **Phase 7:** connect-time SSRF check with real sockets, rate limits, body caps, upload hardening, no HTML sinks) | 403 / 403 |
| `npm run test:integration` | Fixtures, pipeline, structure, a 20-page bulk run + cancel + its Excel and PDF, local Arabic PDF; **Phase 6:** validate → save → compare, upload → re-run, report of a saved run, saved bulk run + comparison with the next run, cancelled bulk run saved (needs vnu and the local Chromium shell) | 18 / 18 |
| `npm run test:e2e` | **Phase 7:** build + Playwright, 14 flows × 4 projects (1280 / 375 px × light / dark) against `next start` on 127.0.0.1:3100 with a throwaway history (needs vnu and the Chromium shell) | 56 / 56 (three full runs; one other full run had a single `net::ERR_NO_BUFFER_SPACE` page load — Windows socket buffers, right after the Lighthouse runs — and passed on re-run) |
| `npm run test:docker` | Arabic PDF + Excel inside the container; **Phase 6:** runs and reports saved through the API (`X-Report-Id`, re-download, files on the volume), comparison, Host/Origin guard + healthcheck, failed migration stops the container; **Phase 7:** guarded URL fetch in the image, 429, 413, security headers (needs `docker compose up -d --build`) | 9 / 9 (clean clone and the `markuplens` stack) |
| `npm run build` | Production build | ok |
| `npm run lighthouse` | **Phase 7:** Lighthouse, 6 pages × mobile / desktop, median of 3 | see below |
| `npm run db:backup` | Backup of `./data` into `backups/` | ok |
| `npm run fixtures:update` | Re-record fixture expectations from the pinned vnu — only after changing `VNU_IMAGE` | — |

Docker check (Phase 4): app container healthy on a fresh `--no-cache` image; single-page validation, structure results, a bulk URL-list run (incl. cancel) and sitemap discovery verified through `127.0.0.1:3000`.

Docker check (Phase 5): `docker compose up --build` from the worktree, then again from the main folder on `main` after the merge (project `markuplens`, same volume); app healthy; PDF with Arabic extracts rendered in the container embeds `NotoSansArabic-Regular/Bold`, text extracts as Arabic (`test-results/docker-arabic-report.pdf`, pages as PNG via `scripts/pdf-to-png.mjs`); report dialog → PDF and Excel downloads verified through `127.0.0.1:3000`.

Docker check (Phase 6): `docker compose up -d --build` from the worktree (project `markuplens`, volume `markuplens_markuplens-data`); the entrypoint applied `20261010000000_init` and the app became healthy; image 1.76 GB. Through `127.0.0.1:3000`: URL validation of the XAMPP dashboard saved ("Saved to history" link), saved run page, server-side re-run, "Compare with previous run" (10 unchanged). Volume backup / restore with `tar` inside the app image verified (restored history served again).

Docker check (Phase 6, after the merge): `npm install` + `docker compose up -d --build` from the main folder on `main` (`aee14e6`); the entrypoint ran `prisma migrate deploy` ("No pending migrations to apply" — the volume already had `20261010000000_init`), the app became healthy, and the existing history (6 runs) was kept on the `markuplens_markuplens-data` volume.

### Lighthouse (Phase 7, final build, median of 3 runs; range of the 3 performance scores in brackets)

| Page | Mobile perf | Mobile LCP / TBT | Desktop perf | Accessibility (mobile / desktop) | Best practices |
|---|---|---|---|---|---|
| Validate (home) `/` | **80** (77–91) | 3.6 s / 390 ms | 100 | 100 / 100 | 100 |
| Bulk `/bulk` | **85** (84–87) | 3.3 s / 310 ms | 100 | 100 / 100 | 100 |
| History `/history` | **80** (77–92) | 4.1 s / 280 ms | 100 | 100 / 100 | 100 |
| Saved run with results `/history/<id>` | **79** (71–84) | 3.7 s / 380 ms | 99 | 100 / 100 | 100 |
| Compare `/history/compare` | **86** (78–88) | 3.2 s / 320 ms | 100 | 100 / 100 | 100 |
| API docs `/api-docs` | **89** (75–90) | 2.9 s / 290 ms | 100 | 100 / 100 | 100 |

- **Accessibility ≥ 95: met everywhere (100).** Before the fixes: saved run 97 and compare 92 (colour contrast of red on its tint; a dangling `aria-controls`).
- **Performance ≥ 85: met on desktop (99–100) and on 3 of 6 pages on mobile.** Home (80), History (80) and the saved run (79) stay below 85 on Lighthouse's mobile preset (simulated slow 4G, 4× CPU slowdown). CLS is 0 everywhere; FCP ≈ 1.1 s. What limits it: LCP is the server-rendered intro text, but in Lighthouse's simulation it waits for the page's JavaScript (React + Next.js runtime ≈ 70 KB gz for `react-dom` alone, ~250 KB gz in total) to download over slow 4G and hydrate at 4× slower CPU; TBT is mostly that hydration. Fixed: results view and report dialog now load on demand (≈ 116 KB raw off Validate and Bulk). Not done, because it would remove features or not be a real improvement: dropping client-side interactivity, the theme toggle or Radix components; tuning for the simulator. Run-to-run spread on this machine is large (e.g. home 77–91), which is why the median of 3 is reported.

Docker check (Phase 7, clean clone): the `markuplens` stack was stopped (`docker compose stop`, history baseline 6 runs / 140,912 bytes); `git clone --branch chore/hardening` into `D:\markuplens-cleancheck`, only `cp .env.example .env`, then `docker compose -p markuplens-cleancheck up --build -d`: fresh volume, `prisma migrate deploy` applied `20261010000000_init` (with the `mysql2` / `deepmerge-ts` overrides), app healthy, vnu online, empty history, home page 200, image 1.76 GB; `npm run test:docker` against it 9 / 9. Its containers, network and volume were then removed (`down -v`, pre-approved). Removing the clone folder was blocked by Claude Code's safety check and is left to the owner; the `markuplens-cleancheck-app` image (1.76 GB) is left too (image removal wasn't part of the approval).

Docker check (Phase 7, `markuplens` stack): `docker compose up --build -d` from the worktree; "No pending migrations to apply"; app healthy; history **6 runs / 140,912 bytes, unchanged**; `npm run test:docker` 9 / 9 (adds 2 small test runs → 8).
