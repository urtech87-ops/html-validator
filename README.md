# MarkupLens

A local HTML/CSS validator with a modern UI and report generation. Validation itself is done by the
self-hosted [Nu Html Checker (vnu)](https://github.com/validator/validator), run in Docker. MarkupLens
never calls the public W3C services.

The full specification lives in [docs/SPEC.md](docs/SPEC.md).

> **Status:** Phase 6 (history & API): every run is saved, with search, re-run, comparison of runs, saved
> reports and a documented JSON API.

## Requirements

- Node.js 22 LTS (see `.nvmrc`; `package.json` declares `"engines": { "node": ">=22" }`)
- npm
- Docker Desktop with Docker Compose v2

## Configuration

```bash
cp .env.example .env
```

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

## vnu version pin

vnu is pinned by **image digest** so validation results never change underneath you:

```
ghcr.io/validator/validator@sha256:0811ae47955ff59e52862df4b4d0cba90cd6fdaa62eefc2806aecb883556e616
```

- **Pinned on:** 2026-10-09. This is the digest `ghcr.io/validator/validator:latest` pointed to on that
  date (image built 2026-10-07). The project publishes no newer numbered image tags than `24.10.17`.
- **Fallback:** if the digest stops working, set `VNU_IMAGE=ghcr.io/validator/validator:24.10.17` in `.env`
  (the newest numbered tag).
- **To update:** resolve the current digest of `:latest`, update `VNU_IMAGE` in `.env.example` and the
  default in `docker-compose.yml`, re-run the fixture tests, and update the date above.

## Option A: local development (recommended while coding)

Run only vnu in Docker and the app with `npm run dev`:

```bash
npm install
docker compose up -d vnu
npm run dev
```

Open http://127.0.0.1:3000. The "Validation engine" card should show **Online**. `npm run dev` listens on
`127.0.0.1` only and first applies the database migrations to `./data/markuplens.db` (`prisma migrate deploy`),
so history works without an extra step. Stop the Docker app container first (`docker compose stop app`): both
use port 3000.

### PDF reports in local development (Playwright browser)

PDF reports are rendered by a headless Chromium driven by `playwright-core`. Inside Docker the browser is
part of the image. For `npm run dev` and the report tests you install it once yourself.

**Keep the browser off a full system drive.** Playwright downloads browsers to
`%USERPROFILE%\AppData\Local\ms-playwright` by default. On this machine C: is nearly full, so the browsers
live on D: via a **Windows user environment variable** that must be set *before* the first download:

```powershell
[Environment]::SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", "D:\ms-playwright", "User")
```

Open a new terminal (or restart your editor) so it picks the variable up, then install only the headless
shell (≈ 110 MB on disk; no full Chrome needed):

```bash
npx playwright-core install --only-shell chromium
```

Check that it landed on D: (`dir D:\ms-playwright` should list a `chromium_headless_shell-*` folder).
If a process started before the variable was set can't find the browser, set it for that shell only
(`$env:PLAYWRIGHT_BROWSERS_PATH = "D:\ms-playwright"`) and start it again.

## Option B: full stack in Docker

```bash
docker compose up --build
```

Open http://127.0.0.1:3000. Both containers publish ports on `127.0.0.1` only, so nothing is reachable
from your network.

The Compose project is named `markuplens` (`name:` in `docker-compose.yml`), so running it from a git
worktree replaces the same `app`/`vnu` containers and reuses the `markuplens_markuplens-data` volume instead
of starting a second stack.

On start the container applies the committed database migrations with the official `prisma migrate deploy`
to `/app/data/markuplens.db` on the `markuplens-data` volume, then starts `node server.js`. If the migration
fails, it prints `MarkupLens: ERROR - the database migration failed, so the app was not started.` and exits
(see `docker compose logs app`).

The app image includes what PDF reports need: the Playwright **Chromium headless shell** (matching the
locked `playwright-core` version) and fonts, **`fonts-noto-core`** (Noto Sans, **Noto Sans Arabic**, Noto
Naskh Arabic) plus **DejaVu Sans Mono** for code extracts. Without Arabic-capable fonts Chromium would print
Arabic as empty boxes. It also carries the Prisma CLI for the migrations. The app image is about 1.76 GB (as
reported by `docker image ls`); check that C: has at least 3 GB free before `docker compose up --build`.

When the app runs inside Docker, `localhost` and `127.0.0.1` in URLs you validate are rewritten to
`host.docker.internal`, so sites served by XAMPP on your machine can still be checked.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Applies migrations, then the Next.js dev server on http://127.0.0.1:3000 |
| `npm run build` / `npm start` | Production build / server (`npm start` also listens on `127.0.0.1` only) |
| `npm run db:migrate` | Apply the committed migrations to `DATA_DIR/markuplens.db` (`prisma migrate deploy`) |
| `npm run db:generate` | Regenerate the Prisma client (`src/generated/prisma`, git-ignored; build, dev, typecheck and tests do it for you) |
| `npm run db:backup` | Copy the history database and saved reports into `backups/<date_time>/` (see [Backing up history](#backing-up-history)) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Vitest unit tests (history tests use throwaway databases under `test-results/`) |
| `npm run test:integration` | Fixture, pipeline, bulk, report (Excel + PDF) and history tests against the real vnu (needs `docker compose up -d vnu` and the [Playwright browser](#pdf-reports-in-local-development-playwright-browser)) |
| `npm run test:docker` | Report tests against the running Docker app (`docker compose up -d --build` first): renders a PDF with Arabic extracts **inside the container** and checks the Noto Arabic fonts are embedded and the Arabic text is extractable; saves runs and reports through the API, checks the localhost guard and that a failed migration stops the container. Set `MARKUPLENS_URL` to use another address (default `http://127.0.0.1:3000`) |
| `node scripts/pdf-to-png.mjs <file.pdf> <outPrefix> [pages] [scale]` | Render PDF pages to PNG (pdf.js) to eyeball a report, e.g. `test-results/docker-arabic-report.pdf` |
| `npm run fixtures:update` | Re-record `tests/fixtures/*.expected.json` from the pinned vnu (only after changing `VNU_IMAGE`) |
| `npm run vnu:up` / `npm run vnu:down` | Start / stop only the vnu container |

## Validation

| Input | Notes |
|---|---|
| **URL** | Fetched server-side: http(s) only, max 5 redirects, 15 s timeout, 5 MB limit, SSRF checks on every hop. Linked stylesheets (`<link rel="stylesheet">`, max 20) are fetched and validated as CSS. Inline `<style>` blocks and `style` attributes are validated by vnu as part of the HTML pass; those messages are tagged **CSS**. |
| **Upload** | `.html .htm .xhtml .css .svg`, up to 20 files, 5 MB each. Extension, MIME type and content are checked (archives/binaries are rejected). |
| **Direct input** | HTML or CSS, always UTF-8. **Fragment** mode wraps the input in a minimal HTML5 page and maps line numbers back to your input. |

- **API:** `POST /api/validate` and `POST /api/validate/upload`; see [API](#api) and the `/api-docs` page.
- **SSRF protection** (every request and every redirect hop, on the *resolved* IP addresses):

  | Destination | `ALLOW_PRIVATE_URLS=false` | `ALLOW_PRIVATE_URLS=true` |
  |---|---|---|
  | Public addresses | allowed | allowed |
  | Loopback (127/8, ::1), 10/8, 172.16/12, 192.168/16, 100.64/10 (CGNAT, e.g. Tailscale), fc00::/7, `host.docker.internal` | blocked | allowed |
  | Cloud metadata & link-local: 169.254.0.0/16, fe80::/10, 100.100.100.200 (Alibaba), fd00:ec2::254 (AWS IPv6), `metadata.google.internal`, `metadata`, `instance-data`, … | **blocked** | **blocked** |
  | 0.0.0.0/8, ::, multicast, broadcast and other reserved ranges | **blocked** | **blocked** |

  IPv4-mapped IPv6 (`::ffff:169.254.169.254`) and decimal/hex/octal IPv4 forms (`http://2852039166/`, `http://0xA9FEA9FE/`) are recognised.
  Only http and https are allowed.
- **Score:** `max(0, 100 − 5 × errors − 1 × warnings)`; info messages don't count. A document passes when it has no errors.
- **Encoding:** BOM → HTTP header → `<meta>` / `@charset`. In auto mode only an HTTP-header charset is forwarded to vnu, so vnu reports encoding problems exactly as validator.w3.org would. An override is forwarded to vnu (optionally only when the document declares nothing).
- **CSS options** (no jigsaw in v1, so *Medium* is not offered). vnu's CSS checker reports errors only and silently accepts vendor-prefixed properties, so:
  - *Warning level* filters CSS messages: none = errors only · normal = + warnings · more/all = + CSS info.
  - *Vendor prefixes*: **Ignore** (default) drops any vnu message about `-webkit-`/`-moz-`/`-ms-`/`-o-` properties; **Treat as warnings** adds one MarkupLens warning per vendor-prefixed property declaration (marked "MarkupLens check" in the results).
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
  queue and aborts requests already in flight. Leaving the page also cancels the run.
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
| **HTML** | The PDF layout as one self-contained file (no external requests; a strict Content-Security-Policy; logo inlined). |
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

`POST /api/report` with `{ runId, format, contents?, branding? }` returns the file (see [API](#api)). The
Phase 5 form with `source` (the results themselves) still works but isn't documented and isn't saved.

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

Documented on the **`/api-docs`** page. In short:

- `POST /api/validate` — `{ type: "url" | "html" | "css", value, fragment?, options?, save? }` → the
  normalised results plus `runId` (`save: true` by default; `save: false` skips history).
- `POST /api/validate/upload` — multipart `files` (+ `options` JSON, `save=false`) → same response.
- `POST /api/report` — `{ runId, format: "pdf" | "xlsx" | "html" | "json" | "csv", contents?, branding? }` →
  the file; `X-Report-Id` is the saved report's id.
- `GET /api/history/reports/:id` — download a saved report again.

**Localhost only:** the app listens on `127.0.0.1` (`next dev -H 127.0.0.1`; Compose publishes
`127.0.0.1:3000`) and answers only requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]` (any port),
which also stops DNS-rebinding pages. Pages are checked in `src/proxy.ts` (API routes are left out there
because Proxy buffers request bodies, 10 MB by default); every API route handler is wrapped in `localOnly()`,
which also refuses requests whose `Origin` is another site. A unit test fails if a route isn't wrapped. The
Docker healthcheck (`fetch('http://127.0.0.1:3000/api/health')`) passes the check.

Other routes used by the UI: `GET /api/history` (list), `GET`/`DELETE /api/history/:id`,
`POST /api/history/:id/rerun`, `GET /api/history/:id/input` (bulk re-run), `DELETE /api/history/reports/:id`,
`GET`/`POST /api/history/compare`, `POST /api/bulk`, `POST /api/sitemap`, `GET /api/health`.

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
run `export MSYS_NO_PATHCONV=1` first, otherwise `/backup` is rewritten to a Windows path and the archive
isn't written.

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

On start the app applies any newer migrations to the restored database.

## Health check

`GET /api/health` posts a tiny HTML document to vnu and returns `200` with `status: "ok"` when vnu
validates it, or `503` with `status: "degraded"` and an error message otherwise.

## Phase 7 hardening backlog

Items deliberately parked until Phase 7 (`chore/hardening`):

- **npm audit: 9 high-severity findings, dev-only.** All come from an outdated `braces` package
  (stack-exhaustion DoS, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)),
  reached through `micromatch` → `fast-glob` in development tooling only:
  - `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`
  - the shadcn CLI (`shadcn`, `@shadcn/registry`, `ts-morph` / `@ts-morph/common`) → `fast-glob` → `micromatch` → `braces`

  The 9 flagged packages: `braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`,
  `eslint-config-next`, `shadcn`, `@shadcn/registry`, `ts-morph`, `@ts-morph/common`.

  None of these run in the app at runtime. `npm audit fix --force` is **not** used because it would
  install breaking major versions; revisit when upstream releases fixed versions.
- **npm audit: 1 moderate (Phase 5), runtime.** `exceljs@4.4.0` → `uuid@8` ("missing buffer bounds check in
  v3/v5/v6 when `buf` is provided"). exceljs only calls `uuid.v4()` without a buffer, so the flaw isn't
  reachable. Revisit when exceljs updates `uuid`.
- **npm audit: 2 low, runtime (client).** `monaco-editor` → `dompurify` (IN_PLACE sanitising issues); also on
  `main`, newly published advisories. Monaco is only used to show code as text.
- **DNS rebinding (outgoing fetches).** The SSRF check resolves the host and validates every address, but `fetch` then resolves
  the name again when it connects. A malicious DNS server could answer differently the second time. Phase 7
  should validate the address at connect time (custom `lookup` on the HTTP agent) so the checked IP is the one
  used. Docker Desktop's DNS and many routers already refuse to return link-local answers, which limits this
  locally.
