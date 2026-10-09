# MarkupLens — progress log

Status as of **2026-10-10**. Specification: [docs/SPEC.md](SPEC.md). Setup details: [README.md](../README.md).

Phases 1–5 of 7 are complete, merged into `main` and pushed. **Next: Phase 6 (`feat/history-api`)**, to be started in a new session.

## Phases

| # | Branch | Merge commit on `main` | Scope delivered |
|---|---|---|---|
| — | — | `f00ec4d` | Initial commit with `docs/SPEC.md` |
| 1 | `feat/foundation` | `fc58619` | Next.js 16.4 scaffold, Tailwind v4 + shadcn/ui, light/dark/system theme (no flash), `/api/health` probing vnu, docker-compose (app + vnu), Dockerfile, Vitest |
| 2 | `feat/validation-core` | `eeb58b5` | URL / multi-file upload / direct input (HTML/CSS, full/fragment), options panel, vnu client + normalisation, results UI (score, cards, filters, search, sort, grouping), Monaco source view, basic SSRF, Docker localhost rewrite, acceptance fixtures; SSRF fix for metadata + CGNAT |
| 3 | `feat/structure` | `808ae0b` | Structure & best-practice checks incl. lang/dir RTL, heading outline, image report, plain-English message guide (58 entries) |
| 4 | `feat/bulk` | `602182c` | Sitemap discovery + URL-list bulk runs, server-side queue with streaming progress, cancel, site summary, most common issues |
| 5 | `feat/reports` | `9eabe9b` | Report dialog, PDF (Playwright Chromium), Excel (5 sheets), HTML, JSON, CSV, branding + logo, Arabic/RTL support, Docker image with Noto Arabic fonts; `.claude/` excluded from git and the Docker build context |
| 6 | `feat/history-api` | — | *Not started* — Prisma history, compare runs, public API + docs |
| 7 | `chore/hardening` | — | *Not started* — SSRF hardening, rate limiting, size limits, e2e tests, README |

Branches are merged with `--no-ff`; nothing is merged into `main` or pushed without the owner's explicit "approved".

## Confirmed decisions

### Project-wide
- Local/internal tool for v1: no accounts, no public deployment. Ports are bound to `127.0.0.1` only.
- Stack as in the spec: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, npm (not pnpm).
- **Node 22 LTS**: `.nvmrc` = 22, `"engines": { "node": ">=22" }`, Docker base image `node:22-bookworm-slim`. Tooling: Vitest 5 / Vite 8.
- Never call validator.w3.org or jigsaw.w3.org — not from code, not during development.
- Phase workflow: one branch per phase, lint + typecheck + tests + build at the end, browser checks listed for the owner, then STOP until "approved".

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

## Machine rules (C: drive is nearly full)

C: filled up on 2026-10-09 and corrupted Docker Desktop's storage (read-only file system, I/O errors, an app image with a 0-byte `package.json`). Since then:

- **Docker Desktop disk image:** `D:\DockerData` (Settings → Resources → Advanced → Disk image location).
- **npm cache:** `D:\npm-cache` (`npm config set cache D:\npm-cache`).
- **Playwright browsers:** `PLAYWRIGHT_BROWSERS_PATH=D:\ms-playwright` is set as a Windows user environment variable (documented in the README). The Chromium headless shell for reports is installed there (`chromium_headless_shell-1243`). Processes started before the variable existed (e.g. an old Claude session) don't see it — set `$env:PLAYWRIGHT_BROWSERS_PATH` in that shell.
- Keep temp output, test artifacts and caches **inside the project on D:** (e.g. git-ignored `test-results/`), not in C: temp folders.
- **Before any large build or pull** (`docker compose up --build`, image pulls, browser installs): check C: free space and **stop if it is under 3 GB**.

## Known issues and notes

- **DNS rebinding:** the SSRF check resolves and validates the host, but `fetch` resolves again when connecting. Fix in Phase 7 (validate the address at connect time). Docker Desktop's DNS and many routers refuse link-local answers, which limits this locally.
- **No rate limiting yet** on `/api/*` (Phase 7).
- **No Playwright e2e tests yet** (Phase 7); Lighthouse (Accessibility ≥ 95, Performance ≥ 85) not measured yet.
- **vnu CSS checker** reports internal errors such as `Cannot invoke "org.w3c.css.values.CssValue.getType()"` on some modern CSS (custom properties). The guide explains them; they can be hidden with a message filter.
- Four rare vnu message kinds have no guide entry (about 2 % of distinct messages on a sample of real sites).
- Sitemap listing stops at 50,000 URLs; very large sites may be truncated (sitemap order).
- Bulk results are lost on page reload until Phase 6.
- **One dev server per project:** Next.js refuses a second `next dev` in the same folder. The Docker app and `npm run dev` both use port 3000 — stop one before starting the other. On Windows, `localhost:3000` may reach the dev server over IPv6 while the container listens on `127.0.0.1:3000`; use `127.0.0.1` to be sure you are testing the container.
- If the app container crash-loops after disk problems (e.g. `Invalid package config /app/package.json`), rebuild without cache: `docker compose build --no-cache app`.
- When testing the API from Git Bash, pass non-ASCII (e.g. Arabic) request bodies from a UTF-8 file (`--data-binary @file.json`); command-line arguments get mangled by the console code page.
- `C:\Users\HP\AppData\Local\ms-playwright` (≈ 1.6 GB) belongs to the Playwright browser tool used for testing, not to this project.
- The app image is ≈ 1.4 GB since Phase 5 (Chromium headless shell + Noto fonts).
- Chromium writes shaped Arabic into PDFs in visual order (some ligatures stay logical), so copy/paste or text extraction from a PDF can show Arabic words reversed; the PDF *displays* correctly. The tests compare Arabic as contiguous letter runs for this reason.
- Reports aren't saved yet: closing the page loses the run, so generate reports before leaving (Phase 6).

## Phase 7 backlog (`chore/hardening`)

- **npm audit, added in Phase 5 (runtime dependencies):**
  - 1 moderate: `exceljs@4.4.0` → `uuid@8` ("missing buffer bounds check in v3/v5/v6 when `buf` is provided"). exceljs only calls `uuid.v4()` without a buffer, so it isn't reachable. Revisit when exceljs updates `uuid`.
  - 2 low: `monaco-editor` → `dompurify` (IN_PLACE sanitising advisories). Newly published advisories, already present on `main` before Phase 5; Monaco only shows code as text. Revisit with a Monaco update.
- **npm audit:** 9 high-severity, dev-only findings, all from an outdated `braces` (GHSA-vfj7-8cjw-p6xm) via `micromatch` → `fast-glob` in `eslint-config-next` / `@next/eslint-plugin-next` and the shadcn CLI (`shadcn`, `@shadcn/registry`, `ts-morph`, `@ts-morph/common`). Not used at runtime. Do **not** run `npm audit fix --force`; revisit when upstream ships fixes.
- DNS-rebinding-safe fetching (check the IP at connect time).
- Rate limit `/api/*` per IP (≈ 30 req/min; one bulk run is a single request).
- SSRF, size-limit and upload hardening with more tests.
- Playwright e2e tests; Lighthouse targets.
- README: setup + deployment.

## How to run

```bash
cp .env.example .env
npm install
docker compose up -d vnu   # vnu only
npm run dev                # http://localhost:3000
```

Full stack in Docker (stop `npm run dev` first; check C: free space ≥ 3 GB):

```bash
docker compose up --build  # http://127.0.0.1:3000
```

## How to test

| Command | What it runs | Last result (Phase 5) |
|---|---|---|
| `npm run lint` | ESLint | clean |
| `npm run typecheck` | `next typegen` + `tsc` | clean |
| `npm test` | Vitest unit tests (incl. report model, Issue IDs, CSV, Excel read-back, HTML, logo, dialog) | 302 / 302 |
| `npm run test:integration` | Fixtures, pipeline, structure, a 20-page bulk run + cancel **+ its aggregated Excel and PDF**, local Arabic PDF (needs vnu and the local Chromium shell) | 13 / 13 |
| `npm run test:docker` | Arabic PDF + Excel rendered **inside the app container** via `POST /api/report` (needs `docker compose up -d --build`) | 2 / 2 |
| `npm run build` | Production build | ok |
| `npm run fixtures:update` | Re-record fixture expectations from the pinned vnu — only after changing `VNU_IMAGE` | — |

Docker check (Phase 4): app container healthy on a fresh `--no-cache` image; single-page validation, structure results, a bulk URL-list run (incl. cancel) and sitemap discovery verified through `127.0.0.1:3000`.

Docker check (Phase 5): `docker compose up --build` from the worktree, then again from the main folder on `main` after the merge (project `markuplens`, same volume); app healthy; PDF with Arabic extracts rendered in the container embeds `NotoSansArabic-Regular/Bold`, text extracts as Arabic (`test-results/docker-arabic-report.pdf`, pages as PNG via `scripts/pdf-to-png.mjs`); report dialog → PDF and Excel downloads verified through `127.0.0.1:3000`.
