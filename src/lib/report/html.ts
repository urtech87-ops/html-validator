import { SEVERITY_RANK, splitExtract } from "@/lib/validation/view";
import type { CheckStatus, ImageInfo, OutlineHeading, Severity } from "@/lib/validation/types";
import { CATEGORY_LABEL, ORIGIN_LABEL, SEVERITY_LABEL, STATUS_LABEL, type ReportDocument, type ReportIssue, type ReportModel } from "./model";
import { MAX_EXAMPLES_PER_GROUP, MAX_GROUPS_PER_DOCUMENT } from "./types";

/**
 * Self-contained HTML report (one file, no external requests). The PDF is
 * this same document printed by headless Chromium, so the layout is A4 and
 * print-safe.
 *
 * Mixed Arabic/English: every piece of user text (messages, extracts, URLs,
 * branding, headings, alt text) is wrapped with dir="auto" and isolated
 * (unicode-bidi: isolate / plaintext), so each run picks its own direction
 * from its first strong character and can't reorder the text around it.
 * The font stacks list Arabic-capable fonts (Noto Sans Arabic / Noto Naskh
 * Arabic in Docker; Segoe UI / Tahoma on Windows) after the Latin ones, so
 * Chromium falls back per character instead of drawing empty boxes.
 */

export const FONT_SANS =
  '"Noto Sans", "Segoe UI", "Helvetica Neue", Arial, "Noto Sans Arabic", "Noto Naskh Arabic", "Segoe UI Arabic", Tahoma, "DejaVu Sans", sans-serif';
/** "ML Arabic" (below) comes first so Arabic in code extracts isn't drawn with a monospace font's stretched Arabic glyphs. */
export const FONT_MONO =
  '"ML Arabic", "DejaVu Sans Mono", Consolas, "Cascadia Mono", "Noto Sans Mono", "Noto Sans Arabic", "Noto Naskh Arabic", "Segoe UI", Tahoma, monospace';

/** Installed Arabic fonts, used only for Arabic code points (local() fonts load nothing from the network). */
const ARABIC_FONT_FACE = ["400", "700"]
  .map(
    (weight) => `@font-face { font-family: "ML Arabic"; font-weight: ${weight};
  src: local("Noto Sans Arabic${weight === "700" ? " Bold" : ""}"), local("NotoSansArabic-${weight === "700" ? "Bold" : "Regular"}"), local("Noto Naskh Arabic"), local("Segoe UI${weight === "700" ? " Bold" : ""}"), local("Tahoma");
  unicode-range: U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFF; }`,
  )
  .join("\n");

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** User-supplied text as an isolated, auto-direction run. */
function t(value: unknown, tag = "bdi"): string {
  return `<${tag} dir="auto">${esc(value)}</${tag}>`;
}

const n = (value: number) => value.toLocaleString("en");
/** "<strong>1</strong> warning" / "<strong>3</strong> warnings". */
const count = (value: number, word: string, plural = `${word}s`) => `<strong>${n(value)}</strong> ${value === 1 ? word : plural}`;

function formatDate(iso: string | undefined, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const date = d.toISOString().slice(0, 10);
  return withTime ? `${date} ${d.toISOString().slice(11, 16)} UTC` : date;
}

function location(i: ReportIssue): string {
  if (i.line === undefined) return "";
  return i.column !== undefined ? `Line ${i.line}, column ${i.column}` : `Line ${i.line}`;
}

function scoreClass(score: number | undefined): string {
  if (score === undefined) return "muted";
  return score >= 90 ? "good" : score >= 60 ? "fair" : "poor";
}

const SEVERITY_ICON: Record<Severity, string> = { error: "✕", warning: "!", info: "i" };
const CHECK_LABEL: Record<CheckStatus, string> = { pass: "Pass", warning: "Warning", fail: "Fail" };

/* ------------------------------------------------------------------ styles */

const CSS = `
${ARABIC_FONT_FACE}
:root { color-scheme: light; --ink: #111827; --muted: #4b5563; --line: #d1d5db; --soft: #f3f4f6;
  --error: #b91c1c; --error-bg: #fde2e1; --warning: #92400e; --warning-bg: #fef3c7; --info: #1e40af; --info-bg: #dbeafe;
  --good: #166534; --good-bg: #dcfce7; --accent: #1d4ed8; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: var(--ink); font: 10pt/1.45 ${FONT_SANS}; }
main { margin: 0 auto; }
@media screen { main { max-width: 190mm; padding: 24px 16px 48px; } }
h1, h2, h3, h4 { line-height: 1.25; margin: 0 0 6px; }
h2 { font-size: 15pt; margin-top: 18px; padding-bottom: 4px; border-bottom: 2px solid var(--ink); }
h3 { font-size: 12pt; margin-top: 14px; }
h4 { font-size: 10pt; margin-top: 10px; }
p { margin: 4px 0; }
bdi, [dir="auto"] { unicode-bidi: isolate; }
pre[dir="auto"], .block[dir="auto"] { unicode-bidi: plaintext; }
.muted { color: var(--muted); }
.small { font-size: 8.5pt; }
.mono { font-family: ${FONT_MONO}; }
.break { break-before: page; page-break-before: always; }
.avoid { break-inside: avoid; page-break-inside: avoid; }
.url { font-family: ${FONT_MONO}; font-size: 8.5pt; overflow-wrap: anywhere; }

/* cover */
.cover { min-height: 250mm; display: flex; flex-direction: column; justify-content: space-between; }
@media screen { .cover { min-height: 0; gap: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--line); } }
.cover-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.brand { font-weight: 700; letter-spacing: .04em; color: var(--accent); }
.logo { max-height: 22mm; max-width: 60mm; object-fit: contain; }
.cover h1 { font-size: 26pt; margin: 24mm 0 4mm; }
.cover .target { font-size: 12pt; overflow-wrap: anywhere; }
.cover dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 16px; margin: 10mm 0 0; }
.cover dt { color: var(--muted); }
.cover dd { margin: 0; overflow-wrap: anywhere; }

/* summary */
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
.tile { border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
.tile .v { font-size: 18pt; font-weight: 700; line-height: 1.1; }
.tile .k { color: var(--muted); font-size: 8.5pt; }
.good { color: var(--good); } .fair { color: var(--warning); } .poor { color: var(--error); }
.t-error .v { color: var(--error); } .t-warning .v { color: var(--warning); } .t-info .v { color: var(--info); }
.chart { margin: 8px 0; }
.bar-row { display: grid; grid-template-columns: 1fr 34mm 12mm; gap: 8px; align-items: center; margin: 4px 0; }
.bar-label { overflow-wrap: anywhere; font-size: 9pt; }
.bar-track { background: var(--soft); height: 10px; border-radius: 3px; overflow: hidden; }
.bar { height: 100%; border-radius: 3px; }
.bar.error { background: var(--error); } .bar.warning { background: #d97706; } .bar.info { background: var(--info); }
.bar-value { text-align: right; font-variant-numeric: tabular-nums; }

/* tables */
table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 8.5pt; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: var(--soft); font-weight: 600; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.wrap { overflow-wrap: anywhere; }

/* badges */
.badge { display: inline-block; border-radius: 4px; padding: 0 5px; font-size: 8pt; font-weight: 700; white-space: nowrap; }
.b-error, .b-fail, .b-errors, .b-not-validated, .b-failed { background: var(--error-bg); color: var(--error); }
.b-warning { background: var(--warning-bg); color: var(--warning); }
.b-info { background: var(--info-bg); color: var(--info); }
.b-pass, .b-passed { background: var(--good-bg); color: var(--good); }
.b-cancelled { background: var(--soft); color: var(--muted); }

/* documents & messages */
.doc { margin-top: 10px; }
.doc.sep { margin-top: 16px; padding-top: 10px; border-top: 2px solid var(--line); }
.doc-head, h3, h4 { break-after: avoid; page-break-after: avoid; }
.doc-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.doc-head h3 { margin: 0; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.facts { color: var(--muted); font-size: 8.5pt; margin: 2px 0 6px; }
.msg { border: 1px solid var(--line); border-left-width: 4px; border-radius: 4px; padding: 6px 8px; margin: 6px 0; break-inside: avoid; page-break-inside: avoid; }
.msg.error { border-left-color: var(--error); } .msg.warning { border-left-color: #d97706; } .msg.info { border-left-color: var(--info); }
.msg-head { display: flex; gap: 6px; align-items: baseline; }
.msg-text { flex: 1 1 auto; font-weight: 600; overflow-wrap: anywhere; }
.count { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.fix { margin: 3px 0 0; font-size: 9pt; }
.example { margin-top: 4px; }
.example .where { color: var(--muted); font-size: 8pt; }
pre.extract { margin: 2px 0 0; padding: 4px 6px; background: var(--soft); border-radius: 3px; font: 8pt/1.4 ${FONT_MONO}; white-space: pre-wrap; overflow-wrap: anywhere; }
pre.extract mark { background: #fde68a; color: inherit; border-radius: 2px; }
.note { border: 1px dashed var(--line); border-radius: 4px; padding: 6px 8px; margin: 6px 0; color: var(--muted); }
.fatal { border: 1px solid var(--error); background: var(--error-bg); color: var(--error); border-radius: 4px; padding: 6px 8px; }
.outline { list-style: none; padding: 0; margin: 4px 0; }
.outline li { padding: 1px 0; overflow-wrap: anywhere; }
.outline .lvl { display: inline-block; min-width: 22px; color: var(--muted); font: 8pt ${FONT_MONO}; }
footer.end { margin-top: 18px; color: var(--muted); font-size: 8pt; border-top: 1px solid var(--line); padding-top: 6px; }
`;

/* -------------------------------------------------------------- sections */

function cover(model: ReportModel): string {
  const b = model.branding;
  const rows: Array<[string, string]> = [
    ["Client / project", b.project ? t(b.project) : "—"],
    ["Prepared by", b.preparedBy ? t(b.preparedBy) : "—"],
    ["Report date", esc(b.reportDate)],
    ["Input type", esc(model.inputType)],
    ["Run date", formatDate(model.runDate)],
    [model.kind === "bulk" ? "Pages checked" : "Documents checked", n(model.pageCount)],
    ["Validation engine", esc(model.engineVersion ? `Nu Html Checker ${model.engineVersion}` : "Nu Html Checker")],
  ];
  return `<section class="cover">
  <div>
    <div class="cover-top">
      <div class="brand">MARKUPLENS</div>
      ${b.logo ? `<img class="logo" src="${esc(b.logo)}" alt="${esc(b.project ? `${b.project} logo` : "Logo")}">` : ""}
    </div>
    <h1>${model.kind === "bulk" ? "Site validation report" : "Validation report"}</h1>
    ${b.project ? `<p class="target" style="font-size:16pt;font-weight:600">${t(b.project)}</p>` : ""}
    <p class="target url">${t(model.target || "—")}</p>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
  </div>
  <div class="tiles">
    <div class="tile"><div class="v ${scoreClass(model.averageScore)}">${model.averageScore ?? "—"}</div><div class="k">${model.kind === "bulk" ? "Average score" : "Score"} / 100</div></div>
    <div class="tile t-error"><div class="v">${n(model.counts.errors)}</div><div class="k">Errors</div></div>
    <div class="tile t-warning"><div class="v">${n(model.counts.warnings)}</div><div class="k">Warnings</div></div>
    <div class="tile t-info"><div class="v">${n(model.counts.info)}</div><div class="k">Info</div></div>
  </div>
</section>`;
}

function topIssueChart(model: ReportModel): string {
  const top = model.issueTypes.slice(0, 5);
  if (top.length === 0) return `<p class="muted">No issues of the selected severities were found.</p>`;
  const max = top[0].occurrences;
  return `<div class="chart" role="img" aria-label="Top ${top.length} issue types by occurrences">
${top
  .map(
    (i) => `  <div class="bar-row avoid">
    <div class="bar-label"><span class="badge b-${i.severity}">${SEVERITY_LABEL[i.severity]}</span> ${t(i.message)}</div>
    <div class="bar-track"><div class="bar ${i.severity}" style="width:${Math.max(2, Math.round((i.occurrences / max) * 100))}%"></div></div>
    <div class="bar-value">${n(i.occurrences)}</div>
  </div>`,
  )
  .join("\n")}
</div>`;
}

function executiveSummary(model: ReportModel): string {
  const validated = model.passed + model.failed;
  const pageWord = model.kind === "bulk" ? "pages" : "documents";
  const common =
    model.kind === "bulk" && model.issueTypes.length > 0
      ? `<h3>Most common issues site-wide</h3>
<table><thead><tr><th>Message</th><th>Severity</th><th class="num">Pages</th><th class="num">Occurrences</th></tr></thead><tbody>
${[...model.issueTypes]
  .sort((a, b) => b.pages - a.pages || b.occurrences - a.occurrences)
  .slice(0, 10)
  .map((i) => `<tr><td class="wrap">${t(i.message)}</td><td><span class="badge b-${i.severity}">${SEVERITY_LABEL[i.severity]}</span></td><td class="num">${n(i.pages)}</td><td class="num">${n(i.occurrences)}</td></tr>`)
  .join("\n")}
</tbody></table>`
      : "";
  return `<section class="break">
<h2>Executive summary</h2>
<div class="tiles">
  <div class="tile"><div class="v ${scoreClass(model.averageScore)}">${model.averageScore ?? "—"}</div><div class="k">${model.kind === "bulk" ? "Average score" : "Score"} / 100</div></div>
  <div class="tile"><div class="v good">${n(model.passed)}</div><div class="k">${pageWord} passed</div></div>
  <div class="tile"><div class="v poor">${n(model.failed)}</div><div class="k">${pageWord} with errors</div></div>
  <div class="tile"><div class="v">${n(model.notValidated)}</div><div class="k">not validated</div></div>
</div>
<p>${n(validated)} of ${n(model.pageCount)} ${pageWord} validated: ${count(model.counts.errors, "error")}, ${count(model.counts.warnings, "warning")} and ${count(model.counts.info, "info message")}${model.kind === "bulk" ? " site-wide (a stylesheet shared by many pages counts once)" : ""}.${model.siteScore !== undefined ? ` Site-wide score: <strong>${model.siteScore}</strong>.` : ""}</p>
${model.cancelled ? `<p class="note">The bulk run was cancelled before every page was checked.</p>` : ""}
<p class="small muted">Score = max(0, 100 − 5 × errors − 1 × warnings). Info messages and structure checks don't affect the score.</p>
<h3>Top ${Math.min(5, model.issueTypes.length) || 5} issue types</h3>
${topIssueChart(model)}
${common}
</section>`;
}

function pagesTable(model: ReportModel): string {
  if (model.documents.length < 2) return "";
  return `<section${model.contents.summary ? "" : ' class="break"'}>
<h2>${model.kind === "bulk" ? "Pages" : "Documents"}</h2>
<table><thead><tr><th class="num">#</th><th>${model.kind === "bulk" ? "Page / document" : "Document"}</th><th>Status</th><th class="num">Score</th><th class="num">Errors</th><th class="num">Warnings</th><th class="num">Info</th></tr></thead><tbody>
${model.documents
  .map(
    (d) => `<tr><td class="num">${d.pageIndex + 1}</td><td class="url">${t(d.url ?? d.label)}${d.linkedFrom && d.linkedFrom > 1 ? ` <span class="muted">(stylesheet, linked from ${d.linkedFrom} pages)</span>` : ""}</td><td><span class="badge b-${d.status}">${STATUS_LABEL[d.status]}</span></td><td class="num">${d.score ?? "—"}</td><td class="num">${d.fatal ? "—" : n(d.counts.errors)}</td><td class="num">${d.fatal ? "—" : n(d.counts.warnings)}</td><td class="num">${d.fatal ? "—" : n(d.counts.info)}</td></tr>`,
  )
  .join("\n")}
</tbody></table>
</section>`;
}

function extractHtml(i: ReportIssue): string {
  if (!i.extract) return "";
  const [before, hit, after] = splitExtract(i.extract, i.hiliteStart, i.hiliteLength);
  return `<pre class="extract" dir="auto">${esc(before)}${hit ? `<mark>${esc(hit)}</mark>` : ""}${esc(after)}</pre>`;
}

interface Group {
  severity: Severity;
  message: string;
  items: ReportIssue[];
}

function groupIssues(issues: ReportIssue[]): Group[] {
  const map = new Map<string, Group>();
  for (const i of issues) {
    const key = `${i.severity}\u0000${i.message}`;
    const g = map.get(key) ?? { severity: i.severity, message: i.message, items: [] };
    g.items.push(i);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.items.length - a.items.length || (a.items[0].line ?? 0) - (b.items[0].line ?? 0));
}

function messagesHtml(d: ReportDocument, model: ReportModel): string {
  if (d.issues.length === 0) {
    return d.fatal ? "" : `<p class="muted">No messages of the selected severities.</p>`;
  }
  const groups = groupIssues(d.issues);
  const shown = groups.slice(0, MAX_GROUPS_PER_DOCUMENT);
  const hidden = groups.length - shown.length;
  const body = shown
    .map((g) => {
      const examples = g.items.slice(0, MAX_EXAMPLES_PER_GROUP);
      const more = g.items.length - examples.length;
      const first = g.items[0];
      return `<div class="msg ${g.severity}">
  <div class="msg-head"><span class="badge b-${g.severity}" aria-label="${SEVERITY_LABEL[g.severity]}">${SEVERITY_ICON[g.severity]} ${SEVERITY_LABEL[g.severity]}</span>
  <span class="msg-text">${t(g.message)}</span>${g.items.length > 1 ? `<span class="count">×${n(g.items.length)}</span>` : ""}</div>
  <div class="small muted">${CATEGORY_LABEL[first.category]}${first.checker === "markuplens" ? " · MarkupLens check" : ""} · ID ${esc(first.id)}${g.items.length > 1 ? " (first)" : ""}</div>
  ${first.fix ? `<p class="fix"><strong>Fix:</strong> ${t(first.fix)}</p>` : ""}
  ${examples
    .filter((e) => e.line !== undefined || e.extract)
    .map((e) => `<div class="example">${e.line !== undefined ? `<div class="where">${location(e)}</div>` : ""}${model.contents.extracts ? extractHtml(e) : ""}</div>`)
    .join("")}
  ${more > 0 ? `<p class="small muted">…and ${n(more)} more ${more === 1 ? "place" : "places"} (all listed in the Excel/CSV report).</p>` : ""}
</div>`;
    })
    .join("\n");
  const note =
    hidden > 0
      ? `<p class="note">Showing the first ${n(MAX_GROUPS_PER_DOCUMENT)} of ${n(groups.length)} message groups for this document. ${n(hidden)} more groups are listed in the Excel, CSV and JSON reports.</p>`
      : "";
  return body + note;
}

function outlineHtml(outline: OutlineHeading[]): string {
  if (outline.length === 0) return `<p class="muted">No headings found.</p>`;
  return `<ol class="outline">${outline
    .map((h) => {
      const issues = h.issues.map((i) => (i === "skipped-level" ? `skipped from h${h.previousLevel}` : i === "extra-h1" ? "extra h1" : "empty")).join(", ");
      return `<li style="padding-inline-start:${(h.level - 1) * 14}px"><span class="lvl">h${h.level}</span>${h.text ? t(h.text) : '<span class="muted">(empty)</span>'}${issues ? ` <span class="badge b-warning">${esc(issues)}</span>` : ""}${h.line ? ` <span class="small muted">line ${h.line}</span>` : ""}</li>`;
    })
    .join("")}</ol>`;
}

const IMAGE_STATUS: Record<ImageInfo["status"], { label: string; cls: string }> = {
  ok: { label: "OK", cls: "b-pass" },
  missing: { label: "Missing alt", cls: "b-fail" },
  empty: { label: "Empty (decorative)", cls: "b-info" },
  filename: { label: "File name", cls: "b-warning" },
  long: { label: "Very long", cls: "b-warning" },
};

function imagesHtml(images: ImageInfo[]): string {
  if (images.length === 0) return `<p class="muted">No images found.</p>`;
  return `<table><thead><tr><th>Image</th><th>Alt text</th><th>Status</th><th class="num">Line</th></tr></thead><tbody>
${images
  .map((img) => {
    const s = IMAGE_STATUS[img.status];
    return `<tr><td class="url">${t(img.src)}</td><td class="wrap">${img.alt === null ? '<span class="muted">(none)</span>' : img.alt === "" ? '<span class="muted">""</span>' : t(img.alt)}</td><td><span class="badge ${s.cls}">${s.label}</span></td><td class="num">${img.line ?? ""}</td></tr>`;
  })
  .join("\n")}
</tbody></table>`;
}

function documentSection(d: ReportDocument, model: ReportModel, index: number): string {
  const c = model.contents;
  const facts = [
    ORIGIN_LABEL[d.origin],
    d.kind.toUpperCase(),
    d.httpStatus ? `HTTP ${d.httpStatus}` : undefined,
    d.encoding ? `Encoding ${d.encoding}` : undefined,
    d.doctype && d.kind !== "css" && d.doctype !== "—" ? d.doctype : undefined,
    d.sizeBytes ? `${n(Math.round(d.sizeBytes / 1024))} KB` : undefined,
    d.linkedFrom && d.linkedFrom > 1 ? `linked from ${d.linkedFrom} pages` : undefined,
  ].filter(Boolean);
  const structure = d.structure;
  return `<section class="doc${index > 0 ? " sep" : ""}">
<div class="doc-head"><h3 class="url" style="font-size:11pt">${t(d.url ?? d.label)}</h3><span class="badge b-${d.status}">${STATUS_LABEL[d.status]}</span>${d.score !== undefined ? `<span class="${scoreClass(d.score)}"><strong>${d.score}</strong>/100</span>` : ""}</div>
${d.origin === "stylesheet" ? `<p class="small muted">Stylesheet of ${t(d.pageUrl, "span")}</p>` : ""}
<p class="facts">${facts.map((f) => esc(f)).join(" · ")}${d.fatal ? "" : ` · ${count(d.counts.errors, "error")}, ${count(d.counts.warnings, "warning")}, ${n(d.counts.info)} info`}</p>
${d.fatal ? `<p class="fatal">${t(d.fatal)}</p>` : ""}
${d.notices.map((x) => `<p class="note">${t(x)}</p>`).join("")}
${c.errors || c.warnings || c.info ? `<h4>Messages</h4>${messagesHtml(d, model)}` : ""}
${structure && c.outline ? `<h4>Heading outline</h4>${outlineHtml(structure.outline)}` : ""}
${structure && c.images ? `<h4>Images (${n(structure.images.length)})</h4>${imagesHtml(structure.images)}` : ""}
</section>`;
}

function structureAppendix(model: ReportModel): string {
  const docs = model.documents.filter((d) => d.structure && d.structure.checks.length > 0);
  if (!model.contents.structure || docs.length === 0) return "";
  return `<section class="break">
<h2>Appendix: structure &amp; best-practice checks</h2>
<p class="small muted">Computed on the parsed page, independent of the validator. Not part of the score.</p>
${docs
  .map(
    (d) => `<h3 class="url" style="font-size:10pt">${t(d.url ?? d.label)} <span class="small muted">— ${d.structure!.counts.fail} fail · ${d.structure!.counts.warning} warning · ${d.structure!.counts.pass} pass</span></h3>
<table><thead><tr><th style="width:24%">Check</th><th style="width:9%">Status</th><th>Explanation</th></tr></thead><tbody>
${d
  .structure!.checks.map(
    (c) => `<tr><td>${esc(c.title)}</td><td><span class="badge b-${c.status}">${CHECK_LABEL[c.status]}</span></td><td class="wrap">${t(c.explanation)}${
      c.details && c.details.length ? `<div class="small muted">${c.details.map((x) => t(x)).join("<br>")}</div>` : ""
    }${c.locations && c.locations.length ? `<div class="small muted">Lines: ${c.locations.map((l) => l.line).join(", ")}${c.affected && c.affected > c.locations.length ? ` (${n(c.affected)} in total)` : ""}</div>` : ""}</td></tr>`,
  )
  .join("\n")}
</tbody></table>`,
  )
  .join("\n")}
</section>`;
}

export interface HtmlOptions {
  /** PDF output: page numbers come from Chromium's footer, so the inline footer is left out. */
  forPdf?: boolean;
}

export function renderHtml(model: ReportModel, opts: HtmlOptions = {}): string {
  const b = model.branding;
  const title = `MarkupLens report — ${b.project || model.target || "validation"}`;
  const c = model.contents;
  const anyMessages = c.errors || c.warnings || c.info;
  const docSections = anyMessages || c.outline || c.images;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="generator" content="MarkupLens">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${cover(model)}
${c.summary ? executiveSummary(model) : ""}
${pagesTable(model)}
${
  docSections
    ? `<section class="break"><h2>${model.kind === "bulk" ? "Page details" : "Details"}</h2>
${model.documents.map((d, i) => documentSection(d, model, i)).join("\n")}
</section>`
    : ""
}
${structureAppendix(model)}
${opts.forPdf ? "" : `<footer class="end">Generated by MarkupLens on ${formatDate(model.generatedAt)}. Validation by the Nu Html Checker${model.engineVersion ? ` ${esc(model.engineVersion)}` : ""}.</footer>`}
</main>
</body>
</html>
`;
}

/** Chromium header/footer templates (they don't inherit the page's styles). */
export function pdfFooterTemplate(model: ReportModel): string {
  const left = [model.branding.project, `MarkupLens report · ${model.branding.reportDate}`].filter(Boolean).join(" · ");
  return `<div style="width:100%;padding:0 14mm;font:7.5pt ${esc(FONT_SANS)};color:#4b5563;display:flex;justify-content:space-between;-webkit-print-color-adjust:exact">
<span dir="auto" style="unicode-bidi:isolate">${esc(left)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}
