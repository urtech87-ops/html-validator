# Claude Code Prompt — "MarkupLens": HTML/CSS Validator with Modern UI + Report Generation

> Paste everything below this line into Claude Code.

---

## 0. Before you write any code

1. **Read the existing code in this repository first.** List the folder structure, read every existing file (package.json, configs, any src/ code, README, .env.example, docker files). If the repo is empty, say so explicitly.
2. Summarise back to me: what already exists, what you will reuse, what you will add, and any conflicts with the plan below.
3. Propose the final folder structure and the branch plan.
4. **STOP and wait for my approval** before creating any files.

---

## 1. What we're building

A web app that validates HTML and CSS — functionally equivalent to the W3C Markup Validation Service (validator.w3.org), the Nu Html Checker, and the W3C CSS Validation Service — but with a modern, clean UI and a **professional report generation feature** (PDF, Excel, HTML, JSON, CSV).

Working name: **MarkupLens** (use an original name and brand — do NOT use the W3C name, logo, or styling anywhere).

**Core principle: do not write our own validator.** Validation accuracy must come from the official open-source engine:

- **Nu Html Checker (vnu)** — the engine behind validator.w3.org/nu. Run it **self-hosted** via its official Docker image (`ghcr.io/validator/validator:latest`, exposes HTTP on port 8888). It validates HTML5, CSS (`--css` / `text/css` content type) and SVG.
- POST the document as the request body with `Content-Type: text/html; charset=utf-8` (or `text/css`) to `http://vnu:8888/?out=json` and parse the JSON `messages[]` array (`type`, `subType`, `message`, `extract`, `firstLine`, `lastLine`, `firstColumn`, `lastColumn`, `hiliteStart`, `hiliteLength`).
- Never call the public validator.w3.org or jigsaw.w3.org from production code (rate limits, 1 req/sec etiquette). A config flag may allow jigsaw as an *optional* secondary CSS checker for CSS-profile options (see §3.4); if implemented, enforce ≥1s between calls.

---

## 2. Tech stack

- **Frontend + API:** Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Code view:** Monaco Editor (direct input + source view with error highlighting)
- **Validation engine:** vnu Docker container
- **HTML parsing for structure analysis:** `cheerio` (or `parse5`)
- **Database:** SQLite via Prisma (validation history, saved reports)
- **Reports:** PDF via Playwright (render the HTML report → `page.pdf()`), Excel via `exceljs`, CSV/JSON native
- **Orchestration:** `docker-compose.yml` with two services: `app` and `vnu`
- **Tests:** Vitest (unit) + Playwright (e2e)

---

## 3. Feature specification

### 3.1 Input methods (parity with W3C)

Three tabs on the home page:

| Tab | Behaviour |
|---|---|
| **Validate by URL** | User enters a URL. Server fetches the page (follow redirects, max 5), then sends the HTML to vnu. Also discover linked stylesheets (`<link rel="stylesheet">`) and inline `<style>` blocks and validate them as CSS. |
| **Validate by File Upload** | Accept `.html`, `.htm`, `.xhtml`, `.css`, `.svg`. Allow **multiple files** in one run (enhancement over W3C). Max 5 MB per file. |
| **Validate by Direct Input** | Monaco editor. Toggle: **HTML / CSS**. Toggle: **Full document / Fragment** (for fragments, wrap in a minimal HTML5 skeleton before sending and offset line numbers back so they match the user's input). |

### 3.2 Bulk / site mode (enhancement)

- **Sitemap mode:** user enters a `sitemap.xml` URL (or a site root — try `/sitemap.xml`, `/sitemap_index.xml`, then robots.txt `Sitemap:` lines). Show the discovered URL list with checkboxes; user selects pages and runs.
- **URL list mode:** paste up to 200 URLs, one per line.
- Run with a concurrency limit (default 3), live progress bar, per-page status, and the ability to cancel.

### 3.3 Options panel ("More options", collapsible)

Parity with W3C, modernised:

- **Character encoding:** auto-detect (default) or override (utf-8, utf-16, windows-1256, iso-8859-6, iso-8859-1, windows-1252, shift_jis, gb18030, big5, etc.). Option "only if missing".
- **Message grouping:** List sequentially (by line) / Group by message type.
- **Show source** with highlighted error lines.
- **Show outline** (heading structure tree).
- **Image report** (all `<img>` with their `alt` values, flagging missing/empty).
- **Validate error pages** (still validate if the URL returns 4xx/5xx; default off — otherwise show the HTTP status as an error).
- **Verbose output** (include `info` messages).
- **User-Agent** selector for URL fetch (default browser UA, Googlebot, mobile).
- **Message filters:** hide specific message texts / regex (persist in localStorage) — mirrors Nu checker message filtering.

### 3.4 CSS options

- Warning level: none / normal / more / all.
- Medium: all, screen, print, handheld, braille, etc. (only applicable if the optional jigsaw checker is enabled; otherwise hide).
- Vendor-prefixed properties: treat as warnings / ignore.

### 3.5 Results view (the main UI upgrade)

- **Summary header:** pass/fail badge, counts of Errors / Warnings / Info, a **quality score (0–100)** with documented formula (e.g. start at 100, −5 per error, −1 per warning, floor 0), document size, detected doctype, detected encoding, response time.
- **Message list:** each message card shows severity icon + colour, message text, line:column, the code `extract` with the exact `hiliteStart/hiliteLength` range highlighted, and a "jump to source" button.
- **Plain-English explanation + suggested fix** for the ~40 most common vnu messages (maintain a local `messageGuide.ts` map: pattern → explanation → example fix). Unknown messages fall back to the raw text.
- Filters: severity, message type, search box; sort by line / severity / frequency.
- **"Group identical messages"** — e.g. "Duplicate ID 'menu' ×12", expandable.
- **Source view:** Monaco read-only with gutter markers on every error/warning line; clicking a marker scrolls the message list.
- **Outline view:** heading tree (h1–h6), flagging skipped levels and multiple/missing h1.
- **Fully responsive** (works at 375px), **dark/light mode**, keyboard accessible, WCAG 2.1 AA contrast.

### 3.6 Structure & best-practice analysis (enhancement — separate "Structure" tab)

Run on the parsed DOM, independent of vnu:

- Heading hierarchy (skipped levels, missing/multiple h1)
- Landmarks present: `header`, `nav`, `main`, `footer` (flag missing `main`)
- `<html lang>` present and valid; `dir` attribute — **flag pages with Arabic/Hebrew/Urdu text whose `lang`/`dir` is missing or not `rtl`**, and flag `dir="rtl"` pages that have no RTL-language content
- `<title>` present and length; meta description; viewport meta; charset meta
- Images without `alt`; links with empty text; buttons without accessible name
- Duplicate IDs; inline `style` attribute count; deprecated elements (`center`, `font`, `marquee`…)
- Forms: inputs without associated `<label>`
- Each check = pass / warning / fail, with a one-line explanation.

### 3.7 Report generation (key feature)

From any single result or bulk run, a **"Generate Report"** button opens a dialog:

- **Formats:** PDF, Excel (.xlsx), HTML (self-contained, single file), JSON, CSV
- **Contents toggles:** summary, errors, warnings, info, source extracts, structure analysis, outline, image report
- **Branding:** project/client name, prepared by, logo upload, report date — appear on the cover/header
- **PDF layout:** cover page → executive summary (score, counts, top 5 issue types chart) → per-page sections → appendix of structure checks. Page numbers and a footer on every page. A4, print-safe colours.
- **Excel layout (structured workbook):**
  - Sheet 1 `Summary` — one row per page: URL, score, errors, warnings, info, status, checked-at
  - Sheet 2 `Issues` — one row per message: page URL, severity, type, message, line, column, extract, suggested fix, status column (Open/Fixed/Won't fix) with data validation dropdown
  - Sheet 3 `Structure` — one row per check per page
  - Sheet 4 `Issue Types` — pivot-style count of each distinct message across all pages
  - Frozen header rows, autofilter on every sheet, severity colour-coding, sensible column widths
- **Bulk report:** aggregate across all pages + "most common issues site-wide".
- Reports are saved to history and re-downloadable.

### 3.8 History & comparison

- Every run saved (input type, target, options, results JSON, score, timestamp).
- History page: table with search/filter, delete, re-run.
- **Compare two runs** of the same URL: show new / fixed / unchanged issues (match on message + normalised extract, not just line number). This is useful for verifying fixes after a dev round.

### 3.9 Public JSON API

- `POST /api/validate` — body `{ type: "url"|"html"|"css", value, options }` → normalised results JSON
- `POST /api/report` — body `{ runId, format, contents, branding }` → file download
- Document both in an `/api-docs` page.

---

## 4. Security & limits (mandatory)

- **SSRF protection** on every server-side URL fetch: resolve DNS and block private/loopback/link-local/metadata ranges (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7), block non-http(s) schemes, re-check after each redirect. Config flag `ALLOW_PRIVATE_URLS=false` (set true only for local/VPN testing).
- Fetch timeout 15s, max response 5 MB.
- Rate limit `/api/*` per IP (e.g. 30 req/min).
- Sanitise everything rendered from user documents (never inject fetched HTML into the DOM; show it only as text/code).
- File upload: validate extension + MIME, reject archives/binaries.

---

## 5. Build phases, branches & checkpoints

Work on a separate branch per phase. **At the end of each phase: run lint + tests, show me a summary of what changed and how to verify it, then STOP and wait for my explicit approval before merging the branch into `main`.**

| Phase | Branch | Scope |
|---|---|---|
| 1 | `feat/foundation` | Next.js scaffold, Tailwind/shadcn, docker-compose with vnu, health check that confirms vnu responds, base layout + dark mode |
| 2 | `feat/validation-core` | Three input methods, options panel, vnu client, result normalisation, results UI (summary, message list, filters, grouping), source view |
| 3 | `feat/structure` | Outline view, image report, structure & best-practice checks incl. lang/dir RTL checks, message guide explanations |
| 4 | `feat/bulk` | Sitemap + URL-list modes, concurrency queue, progress, cancel |
| 5 | `feat/reports` | Report dialog, PDF, Excel, HTML, JSON, CSV, branding |
| 6 | `feat/history-api` | Prisma history, compare runs, public API + docs page |
| 7 | `chore/hardening` | SSRF, rate limiting, size limits, e2e tests, README with setup + deployment |

⛔ **Checkpoint rule:** never merge into `main` without my "approved" message. Never skip a phase's tests.

---

## 6. Acceptance criteria

- Validating a known-bad HTML sample produces the same set of errors as validator.w3.org/nu for that sample (include 3 fixture files in `tests/fixtures/` and a test asserting the expected messages).
- CSS validation works for direct input, upload, and stylesheets discovered from a URL.
- Fragment line numbers map back correctly to the user's input.
- A bulk run of 20 URLs completes with progress and produces a correct aggregated Excel and PDF.
- Excel opens cleanly in Excel and LibreOffice, with filters, frozen headers and the status dropdown working.
- Lighthouse on the app itself: Accessibility ≥ 95, Performance ≥ 85.
- `docker compose up` brings up the whole app from a clean clone with only `.env` copied from `.env.example`.

---

## 7. Out of scope (do not build)

- Legacy DTD-based validation (HTML 4.01, XHTML 1.x, SMIL, MathML 2.0 doctypes from the old W3C validator). HTML5 via vnu only; show detected legacy doctypes as an info notice.
- HTML Tidy "clean up markup" — not in v1.
- RSS/Atom feed validation, link checking, mobileOK.
- User accounts/auth (single-user/local tool for v1).
