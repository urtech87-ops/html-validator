# MarkupLens

A local HTML/CSS validator with a modern UI, history, run comparison and report generation. Validation itself
is done by the self-hosted [Nu Html Checker (vnu)](https://github.com/validator/validator), run in Docker.
MarkupLens never calls the public W3C services.

The full specification lives in [docs/SPEC.md](docs/SPEC.md); decisions and test results per phase are in
[docs/PROGRESS.md](docs/PROGRESS.md).

> **Status:** v1 complete (phases 1–7): validation by URL, upload and direct input; structure checks; bulk
> runs; PDF / Excel / HTML / JSON / CSV reports; history, re-run and comparison; a documented JSON API; and
> the Phase 7 hardening (connect-time SSRF checks, rate limits, request size limits, security headers,
> end-to-end tests).

## Contents

- [Requirements](#requirements) · [Configuration](#configuration) · [vnu version pin](#vnu-version-pin)
- [Running it](#option-a-local-development): [A — local development](#option-a-local-development) · [B — full stack in Docker](#option-b-full-stack-in-docker)
- Features: [Validation](#validation) · [Structure](#structure-outline-images-and-the-message-guide) · [Bulk](#bulk-mode-bulk) · [Reports](#reports) · [History](#history-history) · [Comparing runs](#comparing-runs-historycomparea-idbid)
- [API](#api) · [Security](#security) · [Backing up history](#backing-up-history) · [Testing](#testing)
- [Troubleshooting](#troubleshooting) · [Known limitations](#known-limitations)

## Requirements

- Node.js 22 LTS (see `.nvmrc`; `package.json` declares `"engines": { "node": ">=22" }`)
- npm
- Docker Desktop with Docker Compose v2
- About 3 GB of free space on the drive Docker stores its images on (the app image is about 1.8 GB)

## Configuration

```bash
cp .env.example .env
```

That is the only setup step for Docker: `docker compose up --build` works from a clean clone with the defaults.

| Variable | Default | Purpose |
|---|---|---|
| `VNU_IMAGE` | `ghcr.io/validator/validator@sha256:0811ae47…556e616` | Pinned vnu image (see [vnu version pin](#vnu-version-pin)) |
| `VNU_URL` | `http://localhost:8888` | Where the app reaches vnu (Compose overrides this to `http://vnu:8888`) |
| `VNU_TIMEOUT_MS` | `30000` | Timeout for vnu calls |
| `ALLOW_PRIVATE_URLS` | `true` | Allow validating localhost/LAN/VPN URLs. A notice is shown in the footer while it is on |
| `APP_PORT` | `3000` | Host port for the app container (bound to `127.0.0.1` only) |
| `DATA_DIR` | `./data` | Folder for the history database (`markuplens.db`) and saved reports (`reports/`). Compose overrides it to `/app/data`, the `markuplens-data` volume |
| `HISTORY_MAX_RUNS` | `500` | Keep at most this many runs; the oldest are deleted first |
| `HISTORY_MAX_MB` | `2048` | Keep the stored history (database blobs + saved report files) under this many MiB; the oldest runs are deleted first |
| `RATE_LIMIT_ENABLED` | `true` | `false` turns all rate limits off |
| `RATE_LIMIT_PER_MIN` | `30` | Per client: validate, upload, sitemap, report, re-run, compare and bulk requests per minute |
| `RATE_LIMIT_BULK_PER_MIN` | `5` | Per client, additionally: bulk runs per minute |
| `RATE_LIMIT_BULK_CONCURRENT` | `2` | Bulk runs streaming at the same time (all clients) |
| `RATE_LIMIT_REPORT_PER_MIN` | `10` | Per client, additionally: reports per minute |
| `RATE_LIMIT_READ_PER_MIN` | `120` | Per client: history list / load / delete / saved-report downloads per minute |
| `RATE_LIMIT_GLOBAL_PER_MIN` | `240` | All limited requests from all clients together per minute |

A rate-limit value of `0` means "no limit" for that tier. See [Security](#security) for how the limits work.

## vnu version pin

vnu is pinned by **image digest** so validation results never change underneath you:

```
ghcr.io/validator/validator@sha256:0811ae47955ff59e52862df4b4d0cba90cd6fdaa62eefc2806aecb883556e616
```

- **Pinned on:** 2026-10-09. This is the digest `ghcr.io/validator/validator:latest` pointed to on that
  date (image built 2026-10-07, reports version `26.10.7`). The project publishes no newer numbered image
  tags than `24.10.17`.
- **Fallback:** if the digest stops working, set `VNU_IMAGE=ghcr.io/validator/validator:24.10.17` in `.env`
  (the newest numbered tag).
- **To update:** resolve the current digest of `:latest`, update `VNU_IMAGE` in `.env.example` and the
  default in `docker-compose.yml`, run `npm run fixtures:update` and the fixture tests, and update the date above.

## Option A: local development

Run only vnu in Docker and the app with `npm run dev`:

```bash
cp .env.example .env
npm install
docker compose up -d vnu
npm run dev
```

Open http://127.0.0.1:3000. The "Validation engine" card should show **Online**. `npm run dev` listens on
`127.0.0.1` only and first applies the database migrations to `./data/markuplens.db` (`prisma migrate deploy`),
so history works without an extra step.

**Stop the Docker app container first** (`docker compose stop app`): both use port 3000, and Next.js also
refuses a second `next dev` in the same folder.

For a production build without Docker: `npm run build` then `npm start` (also `127.0.0.1:3000`).

### PDF reports in local development (Playwright browser)

PDF reports are rendered by a headless Chromium driven by `playwright-core`. Inside Docker the browser is
part of the image. For `npm run dev` and the report/e2e tests you install it once yourself.

**Keep the browser off a full system drive.** Playwright downloads browsers to
`%USERPROFILE%\AppData\Local\ms-playwright` by default. If C: is short of space, point it at another drive
with a **Windows user environment variable**, set *before* the first download:

```powershell
[Environment]::SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", "D:\ms-playwright", "User")
```

Open a new terminal (or restart your editor) so it picks the variable up, then install only the headless
shell (≈ 110 MB on disk; no full Chrome needed — the e2e tests use the same shell):

```bash
npx playwright-core install --only-shell chromium
```

Check that it landed where you expect (`dir D:\ms-playwright` should list a `chromium_headless_shell-*`
folder). If a process started before the variable was set can't find the browser, set it for that shell only
(`$env:PLAYWRIGHT_BROWSERS_PATH = "D:\ms-playwright"`) and start it again.

## Option B: full stack in Docker

```bash
cp .env.example .env
docker compose up --build
```

Open http://127.0.0.1:3000. Both containers publish ports on `127.0.0.1` only, so nothing is reachable
from your network.

- The Compose project is named `markuplens` (`name:` in `docker-compose.yml`), so running it from a git
  worktree or a second clone replaces the same `app`/`vnu` containers and reuses the
  `markuplens_markuplens-data` volume (your history) instead of starting a second stack. To try a clone
  without touching that stack, stop it (`docker compose stop`) and use another project name:
  `docker compose -p markuplens-test up --build` (this creates its own, separate volume).
- On start the container applies the committed database migrations with the official `prisma migrate deploy`
  to `/app/data/markuplens.db`, then starts `node server.js`. If the migration fails, it prints
  `MarkupLens: ERROR - the database migration failed, so the app was not started.` and exits
  (see `docker compose logs app`).
- The app image includes what PDF reports need: the Playwright **Chromium headless shell** (matching the
  locked `playwright-core` version) and fonts, **`fonts-noto-core`** (Noto Sans, **Noto Sans Arabic**, Noto
  Naskh Arabic) plus **DejaVu Sans Mono** for code extracts. It also carries the Prisma CLI for the
  migrations. The image is about 1.8 GB (`docker image ls`); check that the Docker drive has at least 3 GB free
  before `docker compose up --build`.
- When the app runs inside Docker, `localhost` and `127.0.0.1` in URLs you validate are rewritten to
  `host.docker.internal`, so sites served on your machine (e.g. XAMPP) can still be checked.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Applies migrations, then the Next.js dev server on http://127.0.0.1:3000 |
| `npm run build` / `npm start` | Production build / server (`npm start` also listens on `127.0.0.1` only) |
| `npm run db:migrate` | Apply the committed migrations to `DATA_DIR/markuplens.db` (`prisma migrate deploy`) |
| `npm run db:generate` | Regenerate the Prisma client (`src/generated/prisma`, git-ignored; build, dev, typecheck and tests do it for you) |
| `npm run db:backup` | Copy the history database and saved reports into `backups/<date_time>/` (see [Backing up history](#backing-up-history)) |
| `npm run lint` / `npm run typecheck` | ESLint / route types + `tsc` |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | Tests against the real vnu (and the local Chromium shell) |
| `npm run test:e2e` | Production build, then the Playwright end-to-end tests (`npm run test:e2e:run` skips the build) |
| `npm run test:docker` | Tests against the running Docker stack |
| `npm run lighthouse` | Lighthouse on the app itself (after `npm run build`) |
| `npm run fixtures:update` | Re-record `tests/fixtures/*.expected.json` from the pinned vnu (only after changing `VNU_IMAGE`) |
| `npm run vnu:up` / `npm run vnu:down` | Start / stop only the vnu container |
| `node scripts/pdf-to-png.mjs <file.pdf> <outPrefix> [pages] [scale]` | Render PDF pages to PNG (pdf.js) to eyeball a report |

See [Testing](#testing) for what each test suite needs and covers.

## Validation

| Input | Notes |
|---|---|
| **URL** | Fetched server-side: http(s) only, max 5 redirects, 15 s timeout, 5 MB limit, SSRF checks on every hop and again at connect time. Linked stylesheets (`<link rel="stylesheet">`, max 20) are fetched and validated as CSS. Inline `<style>` blocks and `style` attributes are validated by vnu as part of the HTML pass; those messages are tagged **CSS**. |
| **Upload** | `.html .htm .xhtml .css .svg`, up to 20 files, 5 MB each. Extension, MIME type and content are checked: archives (ZIP, GZIP, RAR, 7-Zip, TAR, BZIP2, XZ, Zstandard), Office/PDF documents, executables, images and other binaries are refused. |
| **Direct input** | HTML or CSS, always UTF-8. **Fragment** mode wraps the input in a minimal HTML5 page and maps line numbers back to your input. Monaco editor from 640 px up, a plain text area on phones. |

- **Results:** pass/fail, score, counts, document size, doctype, encoding, response time; message cards with
  severity, line:column, the highlighted extract, a plain-English explanation and fix, and *jump to source*;
  filters (severity, HTML/CSS/document, search), sort (line, severity, frequency), *group identical messages*;
  Monaco source view with gutter markers.
- **Score:** `max(0, 100 − 5 × errors − 1 × warnings)`; info messages don't count. A document passes when it has no errors.
- **Encoding:** BOM → HTTP header → `<meta>` / `@charset`. In auto mode only an HTTP-header charset is forwarded to
  vnu, so vnu reports encoding problems exactly as validator.w3.org would. An override is forwarded to vnu
  (optionally only when the document declares nothing).
- **CSS options** (no jigsaw in v1, so *Medium* is not offered). vnu's CSS checker reports errors only and silently
  accepts vendor-prefixed properties, so:
  - *Warning level* filters CSS messages: none = errors only · normal = + warnings · more/all = + CSS info.
  - *Vendor prefixes*: **Ignore** (default) drops any vnu message about `-webkit-`/`-moz-`/`-ms-`/`-o-` properties;
    **Treat as warnings** adds one MarkupLens warning per vendor-prefixed property declaration (marked
    "MarkupLens check").
- **Other options:** validate error pages (4xx/5xx), verbose (info messages), User-Agent for URL fetches
  (browser, Googlebot, mobile), show source / outline / image report.
- **Message filters** (hide by text or regex) and the options panel are saved in your browser's localStorage.
- **vnu size limit:** vnu's default limit is below 5 MB, so `docker-compose.yml` raises it to 6 MiB via `JAVA_TOOL_OPTIONS`.

## Structure, outline, images and the message guide

HTML and XHTML documents also get a **Structure** tab, computed on the parsed DOM independently of vnu
(not part of the score). Each check is *pass / warning / fail* with a one-line explanation and links to
the affected lines:

| Check | Fail / warning when |
|---|---|
| Single `<h1>` | none (fail) · more than one (warning) |
| Heading order | a level is skipped (h1 → h3) or a heading is empty |
| Landmarks | no `<main>` (fail) · `<header>`, `<nav>` or `<footer>` missing (warning); ARIA roles count |
| Page language | `<html lang>` missing, empty or not valid BCP 47 · invalid `dir` value |
| Right-to-left content | mostly Arabic/Hebrew/Urdu-script text (≥ 50 % of letters, ≥ 20 letters) without `dir="rtl"` (fail) or without an RTL `lang` (warning) · mixed content with unmarked RTL passages · `dir="rtl"` on a page with no RTL text |
| `<title>` | missing/empty (fail) · shorter than 10 or longer than 60 characters |
| Meta description | missing, empty, or outside 50–160 characters |
| Viewport meta | missing, no `width=device-width`, or zoom blocked |
| Charset declaration | no `<meta charset>` and no HTTP charset (fail) · declared after 1024 bytes or not UTF-8 |
| Images have alt | any `<img>` without `alt` (fail) · alt that looks like a file name or is over 150 characters |
| Links have text / Buttons have names | no text, `aria-label`, `aria-labelledby`, image alt or `title` |
| Unique IDs | an `id` used more than once |
| Inline styles | any `style` attribute (warning, with count) |
| Deprecated elements | `<center>`, `<font>`, `<marquee>`, `<big>`, `<strike>`, `<tt>` and other obsolete elements |
| Form labels | inputs/selects/textareas without `<label for>`, a wrapping `<label>`, `aria-label(ledby)` or `title`; placeholder-only is called out |

Direct-input **fragments** skip the page-level checks (h1, landmarks, lang/RTL, title, meta, charset).

- **Outline** (option *Show outline*): the h1–h6 tree with skipped levels, empty headings and extra h1s flagged.
- **Images** (option *Image report*): every `<img>` with its alt text, flagged *missing / empty (decorative) /
  file name / very long*. Images are listed as text only; MarkupLens never loads them.
- **Explain & fix:** `src/lib/guide/messageGuide.ts` maps 58 common vnu messages (pattern → explanation →
  fix → before/after example). On a sample of real sites it explained 98 % of distinct messages; anything
  unknown falls back to vnu's own text.

## Bulk mode (`/bulk`)

- **Sitemap:** enter a sitemap URL (`…/sitemap.xml`, `.xml.gz`, `.txt`) or a site root. For a root, MarkupLens
  tries `/sitemap.xml`, `/sitemap_index.xml`, then the `Sitemap:` lines in `robots.txt`, and shows what it tried.
  Sitemap indexes are followed (up to 3 levels, 50 files) and up to 50,000 URLs are listed. Filter the list,
  tick pages (the first 200 are pre-selected) and run.
- **URL list:** paste up to **200** URLs, one per line. Blank lines and `#` comments are ignored, missing
  `http://` is added, duplicates are removed and invalid lines are reported before you run.
- **Running:** pages are checked **3 at a time** by default (1–6 selectable) on the server; results stream back
  (`POST /api/bulk`, newline-delimited JSON) with a live progress bar and per-page status. **Cancel** stops the
  queue and aborts requests already in flight. Leaving the page also cancels the run. At most 2 bulk runs
  stream at once (`RATE_LIMIT_BULK_CONCURRENT`).
- **Results:** site summary (average score, passed / with errors / not validated, site-wide counts) and the
  **most common issues site-wide** (number of pages + occurrences), a sortable page table, and the full
  single-page results for any page you open.
- A stylesheet linked from many pages is fetched and validated **once per run**; in the site-wide totals it
  counts once (per-page numbers still include it).
- To keep the browser responsive, the source view isn't kept for documents over 300 KB in bulk runs.
- Every sitemap and page fetch goes through the same SSRF rules as single-URL validation.

## Reports

**Generate report** appears on single-page results (next to the score), on the bulk **Site summary** once the
run has finished, and on every saved run in History. Reports are built on the server from the **saved run**,
downloaded, and saved with the run so they can be downloaded again from History (newest 20 per run; a report
over 100 MB is downloaded but not saved).

| Format | Contents |
|---|---|
| **PDF** | A4, print-safe. Cover page (branding, target, run date, score and counts) → executive summary (score, passed / with errors, top 5 issue types chart; bulk: most common issues site-wide) → page/document table → per-document details (grouped messages with fix and up to 3 example locations with extracts, outline, image report) → appendix of structure checks. Page numbers and a footer on every page. |
| **Excel** | Five sheets, each with a frozen, filtered header row: **Report Info**, **Summary**, **Issues**, **Structure**, **Issue Types** (see below). |
| **HTML** | The PDF layout as one self-contained file (no external requests or scripts; a strict Content-Security-Policy; logo inlined). |
| **JSON** | The full report model (`schema: "markuplens-report"`, `version: 1`): every message, structure, outline, images. |
| **CSV** | Issues only, one row per message. UTF-8 with BOM, CRLF; cells starting with `= + - @` are prefixed with `'` so spreadsheets don't run them as formulas. |

- **Contents toggles:** summary, errors, warnings, info, source extracts, structure analysis, outline, image report.
  All on by default, except **info**, which follows the run's *Verbose* option. Toggles a format can't use are
  greyed out (Excel has no summary/outline/images; CSV only uses the severities and extracts). Totals and scores
  always describe the whole run; the severity toggles choose which messages are listed.
- **Branding:** client/project, prepared by, report date (defaults to today) and an optional logo: **PNG, JPEG or
  WebP up to 1 MB** (checked by file content; SVG is not accepted). Excel can't show WebP, so a WebP logo
  appears in PDF/HTML only. Project and "prepared by" are remembered in your browser.
- **Limits:** PDF and HTML list at most **500 grouped messages per document** and say how many more there are;
  Excel, CSV and JSON list everything (Excel/CSV stop at 200,000 issue rows).
- **Bulk reports** aggregate all pages; a stylesheet shared by many pages is listed and counted once.
  Pages that failed or were cancelled are listed with their status.

### Excel workbook

| Sheet | One row per | Columns |
|---|---|---|
| **Report Info** | field | Client/project, prepared by, report date, logo (PNG/JPEG), target, input type, run date, generated, pages/documents checked, passed, with errors, not validated, error/warning/info totals, score (bulk: average and site-wide score), engine version, included contents, notes |
| **Summary** | page or document | #, page URL, document, type, status, score, errors, warnings, info, structure fails/warnings, HTTP status, checked at, notes |
| **Issues** | message | **Issue ID**, page URL, document, severity, type, message, line, column, extract, suggested fix, **Status** (Open / Fixed / Won't fix dropdown), **Notes** |
| **Structure** | check per page | page URL, check, status, explanation, details, affected, lines |
| **Issue Types** | distinct message | message, severity, type, pages, occurrences, suggested fix |

Severities and check results are colour-coded. **Issue ID** is the first 10 hex digits of SHA-256 over the
normalised document URL (fragment removed), the message text and the whitespace-collapsed extract. Line numbers
are left out, so the ID stays the same when unrelated edits move the issue. Identical issues in one document get
`-2`, `-3`, … suffixes.

### Arabic and other right-to-left text

- PDF/HTML: every message, extract, URL, heading, alt text and branding field is its own bidi-isolated run
  (`dir="auto"`, `unicode-bidi: isolate` / `plaintext`), so mixed Arabic/English shows in the right order.
  Font stacks fall back to Noto Sans Arabic / Noto Naskh Arabic (Docker) or Segoe UI / Tahoma (Windows); Arabic
  inside code extracts uses the Arabic font rather than a monospace font's narrow Arabic glyphs.
- Excel: any cell containing Arabic (or Hebrew, Urdu, …) text uses **right-to-left reading order**.

## History (`/history`)

- **Every run is saved**: single URL, upload and direct-input runs when they finish (`/api/validate` and
  `/api/validate/upload` return its `runId`); bulk runs **as they go**, so a cancelled run keeps the pages it
  finished (a run cut off by a restart shows as *Interrupted*). Saved: input type, target, options, results
  (gzipped JSON), score, counts, timestamps and the input needed to **re-run** it.
- **Size rules:** document sources are kept up to **10 MB per run** (the source view says when a source wasn't
  kept); bulk runs still drop sources over 300 KB. An input over 10 MB (large uploads) isn't kept, so that run
  can't be re-run.
- **Retention:** at most `HISTORY_MAX_RUNS` (500) runs and `HISTORY_MAX_MB` (2048 MiB) of stored data, the oldest
  runs (with their reports) deleted first; runs in progress are never deleted. After deletions the database is
  compacted (`VACUUM`) once at least a quarter of it, or 64 MB, is free space.
- **History page:** search (target or run ID), filter by type and result, sort (date, score, errors, target),
  25 runs per page, delete (one or many), **re-run with the original options** (single runs run on the server;
  bulk runs restart on `/bulk` with their URLs, options and concurrency), and **compare** two selected runs.
- **Saved run** (`/history/<id>`): the full results as after the run, its options, saved reports (download
  again / delete), Generate report, Re-run, Delete and **Compare with previous run** (the latest earlier run of
  the same target).

### Comparing runs (`/history/compare?a=<id>&b=<id>`)

- The earlier run is always "before". Issues are matched by the **same Issue ID as the Excel report** (document
  URL + message + whitespace-collapsed extract; line numbers ignored; `-2`, `-3` for duplicates in a document):
  **new** (only later), **fixed** (only earlier), **unchanged** (both). An unchanged issue whose severity
  changed is marked *before → after*.
- **Single runs** are matched by target (normalised URL, `direct:html` / `direct:css`, or the uploaded file
  names) and compared document by document. **Bulk runs** are compared by site, page by page (URL, fragment
  ignored): pages only in one run are listed as added / removed, pages that failed or weren't checked in
  either run as *not comparable*; a stylesheet linked from many pages is compared and counted **once**.
- A warning lists **options that differ** between the runs (encoding, error pages, verbose, User-Agent, CSS
  warning level, vendor prefixes), since they change results; a changed validator version is noted too.
- **Download JSON** (`schema: "markuplens-compare"`, `version: 1`) or **Download comparison (Excel)**: sheets
  *Comparison Info* (both runs, scores, options-difference warning, totals, branding), *Pages* (per page or
  document: URL, score before/after, new, fixed, unchanged, comparable) and *Issues* (Issue ID, page URL,
  document, change, severity before/after, message, line, extract, suggested fix, Status dropdown, Notes).
  Same styling as the report workbook: frozen, filtered headers; Change coloured red (New), green (Fixed),
  grey (Unchanged); Arabic cells right-to-left. Project / prepared by come from the report dialog's saved
  branding.

## API

Documented on the **`/api-docs`** page, with curl examples. In short:

- `POST /api/validate` — `{ type: "url" | "html" | "css", value, fragment?, options?, save? }` → the
  normalised results plus `runId` (`save: true` by default; `save: false` skips history).
- `POST /api/validate/upload` — multipart `files` (+ `options` JSON, `save=false`) → same response.
- `POST /api/report` — `{ runId, format: "pdf" | "xlsx" | "html" | "json" | "csv", contents?, branding? }` →
  the file; `X-Report-Id` is the saved report's id.
- `GET /api/history/reports/:id` — download a saved report again.

Errors are JSON `{ "error": "…" }` with `400`, `403` (not local), `404`, `413` (too large), `429` (rate limit,
with `Retry-After`) or `503` (PDF renderer or database unavailable).

Other routes used by the UI: `GET /api/history` (list), `GET`/`DELETE /api/history/:id`,
`POST /api/history/:id/rerun`, `GET /api/history/:id/input` (bulk re-run), `DELETE /api/history/reports/:id`,
`GET`/`POST /api/history/compare`, `POST /api/bulk`, `POST /api/sitemap`, `GET /api/health`.

`GET /api/health` posts a tiny HTML document to vnu and returns `200` with `status: "ok"` when vnu validates
it, or `503` with `status: "degraded"` and an error message otherwise.

## Security

MarkupLens is a **single-user tool for this machine**: no accounts, no API keys. Anyone who can reach the port
can use it, so it must not be exposed to a network.

### Access: localhost only

The app listens on `127.0.0.1` (`next dev -H 127.0.0.1`, `next start -H 127.0.0.1`; Compose publishes
`127.0.0.1:3000`) and answers only requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]` (any port), which
also stops DNS-rebinding pages aimed at the app. Pages are checked in `src/proxy.ts` (API routes are left out
there because Proxy buffers request bodies); every API route handler is wrapped in `localOnly()`, which also
refuses requests whose `Origin` is another site, and applies the rate limits. A unit test fails if a route
isn't wrapped. The Docker healthcheck (`fetch('http://127.0.0.1:3000/api/health')`) passes the check.

### Outgoing fetches (SSRF)

Every server-side fetch (pages, stylesheets, sitemaps, robots.txt) is checked on the **resolved** IP
addresses before the first request and on every redirect hop:

| Destination | `ALLOW_PRIVATE_URLS=false` | `ALLOW_PRIVATE_URLS=true` |
|---|---|---|
| Public addresses | allowed | allowed |
| Loopback (127/8, ::1), 10/8, 172.16/12, 192.168/16, 100.64/10 (CGNAT, e.g. Tailscale), fc00::/7, `host.docker.internal` | blocked | allowed |
| Cloud metadata & link-local: 169.254.0.0/16, fe80::/10, 100.100.100.200 (Alibaba), fd00:ec2::254 (AWS IPv6), `metadata.google.internal`, `metadata`, `instance-data`, … | **blocked** | **blocked** |
| 0.0.0.0/8, ::, multicast, broadcast and other reserved ranges | **blocked** | **blocked** |

- IPv4-mapped IPv6 (`::ffff:169.254.169.254`) and decimal/hex/octal IPv4 forms (`http://2852039166/`,
  `http://0xA9FEA9FE/`) are recognised. Only http and https are allowed.
- **DNS rebinding:** fetches go through `undici` with an agent whose connect-time DNS lookup applies the same
  rules to the addresses the socket actually connects to. A DNS server that answers with a public address for
  the check and a private or metadata address for the connection gets the connection refused.
- Limits: 15 s, 5 MB (streamed and cut off, also after decompression), 5 redirects, 20 stylesheets per page;
  sitemaps: 50 files, 3 levels, 50 MB unzipped, 50,000 URLs.

### Rate limits

Per client and minute (sliding window), in memory:

| Requests | Default |
|---|---|
| validate, upload, sitemap, report, re-run, compare, bulk | 30 |
| bulk runs (additionally) | 5, and at most 2 running at once |
| reports (additionally) | 10 |
| other `/api/history*` (list, load, delete, saved report download) | 120 |
| all clients together | 240 |
| `GET /api/health` | not limited |

Over a limit the API answers `429` with `Retry-After`, and the UI shows the message. The client is identified
by `x-forwarded-for`, which Next.js fills from the socket address only when the request doesn't bring one,
so a client could fake it; the global cap bounds what that achieves (and only local clients get in anyway).
Settings: `RATE_LIMIT_*` in [Configuration](#configuration).

### Request size limits

Bodies are read with a cap (a declared `Content-Length` over it is refused at once; a chunked body is
stopped as soon as it passes it) → `413`:

| Endpoint | Body limit | Input limit inside it |
|---|---|---|
| `POST /api/validate` | 12 MB | the document: 5 MB |
| `POST /api/validate/upload` | 101 MB | 20 files × 5 MB |
| `POST /api/bulk` | 2 MB | 200 URLs |
| `POST /api/report` | 60 MB | logo 1 MB |
| `POST /api/sitemap`, `POST /api/history/compare` | 64 KB | URL 2048 characters |
| `DELETE /api/history` | 256 KB | 1000 run ids |

### User content is only shown as text

Fetched pages, uploads and direct input are never inserted into the page as HTML: React escapes all text,
extracts and source are shown as text or in Monaco, images in documents are never loaded. A unit test fails if
`dangerouslySetInnerHTML` or a DOM HTML sink appears anywhere except the static theme script, and an e2e test
validates a page full of `<script>`, `onerror`, `<svg onload>`, `javascript:` and `srcdoc` and checks nothing
runs. HTML reports escape everything, contain no scripts, carry a strict CSP and are served as downloads with a
`sandbox` CSP and `nosniff`.

### Headers

Every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`;
pages also `Content-Security-Policy: frame-ancestors 'none'`.

### Dependencies

`npm audit` findings and why the remaining ones are accepted are listed in
[docs/PROGRESS.md](docs/PROGRESS.md#dependencies-npm-audit). `npm audit fix --force` is never used.

## Backing up history

History is one SQLite file (`markuplens.db`, WAL mode) plus the `reports/` folder, both in `DATA_DIR`.

**`npm run dev` (./data):**

```bash
npm run db:backup
```

copies the database (with SQLite's online backup, safe while the app runs) and `data/reports` into
`backups/<date_time>/` (git- and Docker-ignored). To restore, stop `npm run dev`, then copy `markuplens.db` and
`reports/` from a backup folder back into `data/` (delete `data/markuplens.db-wal` and `-shm` if present).

**Docker (the `markuplens_markuplens-data` volume):** stop the app so the database is consistent, archive the
volume into `./backups` with the app image itself, and start it again. This works in PowerShell; in Git Bash
run `export MSYS_NO_PATHCONV=1` first (see [Troubleshooting](#git-bash-mangles-docker-paths)).

```bash
docker compose stop app
docker compose run --rm --no-deps -v ./backups:/backup --entrypoint sh app -c 'tar czf /backup/markuplens-data-$(date +%Y%m%d-%H%M%S).tgz -C /app/data .'
docker compose start app
```

The archive name uses the container's clock (UTC). To restore one (this **replaces** the current history; the
archive is checked before anything is deleted), put its name in `f=`:

```bash
docker compose stop app
docker compose run --rm --no-deps -v ./backups:/backup --entrypoint sh app -c 'f=/backup/markuplens-data-20261010-110336.tgz && tar tzf "$f" >/dev/null && find /app/data -mindepth 1 -delete && tar xzf "$f" -C /app/data'
docker compose start app
```

On start the app applies any newer migrations to the restored database. **Never** use
`docker compose down -v`, `docker volume rm` or `docker volume prune` unless you mean to delete your history.

## Testing

| Command | Needs | Covers |
|---|---|---|
| `npm run lint`, `npm run typecheck` | — | ESLint; route types + `tsc` (app, tests, scripts' TS) |
| `npm test` | — | Unit tests: normalisation, fragments, SSRF rules, **connect-time check with real sockets**, **rate limits**, **body limits**, uploads, structure, guide, reports (Excel read-back, CSV, HTML), history store / retention / compare against throwaway SQLite databases, the localhost guard and "every API route is wrapped", "no HTML sinks" |
| `npm run test:integration` | `docker compose up -d vnu`, the Chromium shell | Acceptance fixtures (3 known-bad files), pipeline, CSS, 20-page bulk run + cancel + its Excel and PDF, Arabic PDF, history: validate → save → compare, upload → re-run, saved bulk runs |
| `npm run test:e2e` | vnu, the Chromium shell; builds first | Playwright against a production build (see below) |
| `npm run test:docker` | `docker compose up -d --build` | Inside the container: Arabic PDF/Excel, runs and reports saved through the API, Host/Origin guard, failed migration stops the container, guarded URL fetch, 429, 413, security headers. `MARKUPLENS_URL` overrides `http://127.0.0.1:3000` |
| `npm run lighthouse` | `npm run build`, vnu, Chrome | Lighthouse (mobile and desktop, median of 3) on 6 pages |

**End-to-end tests** (`tests/e2e`, `playwright.config.ts`) start a production server (`next start` on
`127.0.0.1:3100`) with a **throwaway history in `test-results/e2e/data`** (never `./data` or the Docker volume)
and a small fixture website on `127.0.0.1:3199`, so nothing leaves the machine. They run in four projects —
desktop 1280 px and phone 375 px, each in light and dark — and every test checks the colour scheme and that
the page doesn't scroll sideways. Flows: validate by URL (messages, linked stylesheet, structure, outline,
images, source), upload (several files; an archive refused), direct input (fragment line mapping, CSS), bulk
URL list with an aggregated Excel, sitemap discovery, cancel, all five report formats and their saved
re-download, a script-injection probe, security headers, the 429 limit, history search / compare /
comparison Excel, re-run, delete, `/api-docs` and the theme toggle. Each test sends its own `x-forwarded-for`,
so the per-client limits stay at their defaults; the global cap and the concurrent-bulk limit are off there.
Reports and traces of failures: `test-results/e2e/`.

**Lighthouse** (`scripts/lighthouse.mjs`) uses the same throwaway server, saves two runs so the saved-run and
compare pages have content, and writes HTML/JSON reports and `scores.json` to `test-results/lighthouse/`. The
latest scores are in [docs/PROGRESS.md](docs/PROGRESS.md).

All test output stays in the git-ignored `test-results/` folder in the project.

## Troubleshooting

### The drive is full / Docker fails with "read-only file system"

When the drive holding Docker Desktop's disk image fills up, Docker's storage can be corrupted: builds fail
with `read-only file system` or I/O errors, or the app container crash-loops with errors like
`Invalid package config /app/package.json` (a 0-byte file in the image).

1. Free space first (keep at least 3 GB free before `docker compose up --build`, image pulls or browser
   installs). Reclaim Docker's **build cache** safely with `docker builder prune` (it does not touch images,
   containers or volumes). Don't use `docker system prune` or `docker volume prune`: they can delete your
   history volume.
2. Restart Docker Desktop.
3. Rebuild the app image without cache: `docker compose build --no-cache app`, then `docker compose up -d`.
4. To keep it from happening again, move Docker's disk image to a bigger drive (Docker Desktop → Settings →
   Resources → Advanced → Disk image location), and the npm cache and Playwright browsers too
   (`npm config set cache D:\npm-cache`, `PLAYWRIGHT_BROWSERS_PATH` as in
   [PDF reports in local development](#pdf-reports-in-local-development-playwright-browser)).

### Git Bash mangles Docker paths

Git Bash (MSYS) rewrites arguments that look like Unix paths, so `-v ./backups:/backup` mounts a Windows path
instead of `/backup` and the backup isn't written. Run `export MSYS_NO_PATHCONV=1` in that shell first, or use
PowerShell. Also in Git Bash: pass non-ASCII (e.g. Arabic) request bodies to `curl` from a UTF-8 file
(`--data-binary @body.json`); command-line arguments get mangled by the console code page.

### Port 3000 is busy / "another next dev is running"

The Docker app and `npm run dev` both use port 3000. Stop one first: `docker compose stop app` (or stop
`npm run dev`). Use http://127.0.0.1:3000 to be sure which one you reach.

### "Validation engine: Offline"

vnu isn't running or isn't reachable: `docker compose up -d vnu` (local development uses `VNU_URL=http://localhost:8888`).
The first start of vnu takes a few seconds.

### PDF reports fail locally ("PDF renderer unavailable")

The Chromium headless shell isn't installed, or the process can't see `PLAYWRIGHT_BROWSERS_PATH`; see
[PDF reports in local development](#pdf-reports-in-local-development-playwright-browser).

### "Too many … requests" (429)

You hit a rate limit (e.g. a script calling the API in a loop). Wait for the seconds in `Retry-After`, slow the
script down, or raise the matching `RATE_LIMIT_*` value in `.env` and restart the app.

### e2e tests time out with `ERR_NETWORK_IO_SUSPENDED`

Windows went to sleep during the run. Keep the machine awake while the tests run.

## Known limitations

- **Local, single-user tool:** no accounts or API keys; it must not be exposed beyond `127.0.0.1`. History
  lives on one machine only (back it up with `npm run db:backup` or the Docker commands above).
- **Rate limits are per process and in memory:** they reset when the app restarts, and the client address can
  be faked (bounded by the global cap).
- **vnu CSS checker** reports internal errors such as `Cannot invoke "org.w3c.css.values.CssValue.getType()"`
  on some modern CSS (custom properties). The guide explains them; hide them with a message filter if needed.
- **No jigsaw:** the CSS *Medium* option and CSS profiles of the W3C CSS validator aren't available; HTML5
  only (no legacy DTD validation, no Tidy clean-up, no feed or link checking).
- Four rare vnu message kinds have no guide entry (about 2 % of distinct messages on a sample of real sites).
- **Sitemaps:** listing stops at 50,000 URLs (sitemap order); a bulk run checks at most 200 pages.
- **PDF copy/paste of Arabic:** Chromium writes shaped Arabic in visual order, so copying or extracting Arabic
  text from a PDF can give reversed words; the PDF *displays* correctly.
- **Excel and WebP logos:** a WebP logo appears in PDF/HTML reports only.
- **Mobile Lighthouse performance** is below 85 on some pages under Lighthouse's simulated slow 4G and 4× CPU
  slowdown; see [docs/PROGRESS.md](docs/PROGRESS.md) for the scores and what limits them. Desktop scores are
  99–100.
- Leaving the bulk page cancels a running bulk run (by design: the run streams to the open page).
