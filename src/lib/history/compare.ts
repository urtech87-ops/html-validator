import "server-only";
import type { BulkPage } from "@/lib/bulk/aggregate";
import { normalizeUrlForId, toIssues, type ReportIssue } from "@/lib/report/model";
import { defaultContents } from "@/lib/report/types";
import { USER_AGENTS, type ValidationOptions } from "@/lib/validation/options";
import type { DocumentResult, RunResult } from "@/lib/validation/types";
import type { CompareDocument, CompareIssue, CompareResult, CompareRunInfo, OptionDifference } from "./compare-types";
import { normalizeTargetUrl } from "./target-key";
import { INPUT_TYPE_LABEL, type SavedRun } from "./types";

/**
 * Compare two saved runs. Issues are matched by the same Issue ID as the Excel
 * report (document URL + message + whitespace-collapsed extract, -2/-3 for
 * duplicates), so line shifts don't count as changes:
 *   new = only in the later run · fixed = only in the earlier run · unchanged = in both.
 * Documents are matched by URL/name: single runs document by document, bulk
 * runs page by page plus each shared stylesheet once. Documents that exist in
 * only one run, or failed in either, are listed but their issues aren't counted.
 */

const ALL_CONTENTS = defaultContents(true);

interface Unit {
  key: string;
  pageUrl: string;
  document: string;
  role: CompareDocument["role"];
  doc?: DocumentResult;
  /** Why the unit can't be compared (fatal, failed page, cancelled). */
  unavailable?: string;
  linkedFrom?: number;
  isPage: boolean;
}

function roleOf(doc: DocumentResult): CompareDocument["role"] {
  if (doc.origin === "stylesheet") return "stylesheet";
  if (doc.origin === "upload") return "file";
  if (doc.origin === "direct") return "direct";
  return "page";
}

function singleUnits(run: RunResult): Unit[] {
  const pageUrl = run.documents[0]?.url ?? run.input.target;
  return run.documents.map((doc) => {
    const role = roleOf(doc);
    const ref = doc.url ?? doc.label;
    return {
      key: role === "direct" ? `direct:${doc.kind}` : `${role}:${normalizeUrlForId(ref)}`,
      pageUrl: run.input.type === "url" ? pageUrl : ref,
      document: ref,
      role,
      doc,
      unavailable: doc.fatal,
      isPage: role !== "stylesheet",
    };
  });
}

function pageProblem(page: BulkPage): string | undefined {
  if (page.status === "error") return page.error ?? "The page could not be validated.";
  if (page.status !== "done" || !page.run) return "Not checked (run cancelled).";
  return page.run.documents[0]?.fatal;
}

function bulkUnits(pages: BulkPage[]): Unit[] {
  const units: Unit[] = [];
  const sheets = new Map<string, Unit>();
  for (const page of pages) {
    const pageKey = `page:${normalizeTargetUrl(page.url)}`;
    const problem = pageProblem(page);
    const main = page.run?.documents[0];
    units.push({ key: pageKey, pageUrl: page.url, document: main?.url ?? page.url, role: "page", doc: problem ? undefined : main, unavailable: problem, isPage: true });
    if (problem || !page.run) continue;
    for (const doc of page.run.documents.slice(1)) {
      const ref = doc.url ?? doc.label;
      const key = `stylesheet:${normalizeUrlForId(ref)}`;
      const existing = sheets.get(key);
      if (existing) {
        existing.linkedFrom = (existing.linkedFrom ?? 1) + 1;
        continue;
      }
      // A shared stylesheet is compared once, attributed to the first page linking it (as in reports).
      const unit: Unit = { key, pageUrl: page.url, document: ref, role: "stylesheet", doc, unavailable: doc.fatal, linkedFrom: 1, isPage: false };
      sheets.set(key, unit);
      units.push(unit);
    }
  }
  return units;
}

function unitsOf(saved: SavedRun): Unit[] {
  return saved.data.kind === "single" ? singleUnits(saved.data.run) : bulkUnits(saved.data.bulk.pages);
}

function toCompareIssue(i: ReportIssue, change: CompareIssue["change"], before?: ReportIssue): CompareIssue {
  return {
    id: i.id,
    change,
    pageUrl: i.pageUrl,
    document: i.document,
    documentKind: i.documentKind,
    severityBefore: change === "new" ? undefined : (before ?? i).severity,
    severityAfter: change === "fixed" ? undefined : i.severity,
    category: i.category,
    message: i.message,
    line: i.line,
    column: i.column,
    extract: i.extract,
    hiliteStart: i.hiliteStart,
    hiliteLength: i.hiliteLength,
    fix: i.fix,
  };
}

/* ---------------------------------------------------------------- options */

const onOff = (v: boolean) => (v ? "on" : "off");

/** Only options that change which messages a run reports. */
function describeOptions(o: ValidationOptions): Array<[string, string]> {
  return [
    ["Character encoding", o.encoding.override === "auto" ? "auto-detect" : o.encoding.override],
    ["Encoding override only if missing", onOff(o.encoding.onlyIfMissing)],
    ["Validate error pages", onOff(o.validateErrorPages)],
    ["Verbose output (info messages)", onOff(o.verbose)],
    ["User-Agent", USER_AGENTS[o.userAgent]?.label ?? o.userAgent],
    ["CSS warning level", o.css.warningLevel],
    ["Vendor-prefixed properties", o.css.vendorPrefixes === "warn" ? "treat as warnings" : "ignore"],
  ];
}

export function optionDifferences(a: ValidationOptions, b: ValidationOptions): OptionDifference[] {
  const before = describeOptions(a);
  const after = new Map(describeOptions(b));
  return before.filter(([k, v]) => after.get(k) !== v).map(([option, v]) => ({ option, before: v, after: after.get(option)! }));
}

/* ----------------------------------------------------------------- compare */

function runInfo(saved: SavedRun): CompareRunInfo {
  const s = saved.summary;
  return {
    id: s.id,
    createdAt: s.createdAt,
    kind: s.kind,
    inputType: s.inputType,
    target: s.target,
    status: s.status,
    score: s.score,
    counts: s.counts,
    pageCount: s.pageCount,
    engineVersion: s.engineVersion,
  };
}

export class CompareError extends Error {}

/** Compare two saved runs; the earlier one (by date) is "before". */
export function compareRuns(x: SavedRun, y: SavedRun, now = new Date()): CompareResult {
  if (x.summary.id === y.summary.id) throw new CompareError("Choose two different runs to compare.");
  if (x.summary.kind !== y.summary.kind) throw new CompareError("A single-page run can't be compared with a bulk run.");
  const [before, after] = Date.parse(x.summary.createdAt) <= Date.parse(y.summary.createdAt) ? [x, y] : [y, x];

  const beforeUnits = new Map(unitsOf(before).map((u) => [u.key, u]));
  const afterUnits = unitsOf(after);
  const afterKeys = new Set(afterUnits.map((u) => u.key));
  const ordered: Array<{ a?: Unit; b?: Unit }> = [
    ...afterUnits.map((b) => ({ a: beforeUnits.get(b.key), b })),
    ...[...beforeUnits.values()].filter((a) => !afterKeys.has(a.key)).map((a) => ({ a })),
  ];

  const documents: CompareDocument[] = [];
  const issues: CompareIssue[] = [];
  const totals = { new: 0, fixed: 0, unchanged: 0, severityChanged: 0 };
  const pages = { compared: 0, added: [] as string[], removed: [] as string[], notComparable: [] as Array<{ url: string; reason: string }> };

  for (const { a, b } of ordered) {
    const unit = (b ?? a)!;
    const row: CompareDocument = {
      key: unit.key,
      pageUrl: unit.pageUrl,
      document: unit.document,
      role: unit.role,
      status: "compared",
      scoreBefore: a?.doc && !a.unavailable ? a.doc.score : undefined,
      scoreAfter: b?.doc && !b.unavailable ? b.doc.score : undefined,
      new: 0,
      fixed: 0,
      unchanged: 0,
      linkedFrom: unit.role === "stylesheet" && before.summary.kind === "bulk" ? unit.linkedFrom : undefined,
    };
    documents.push(row);

    if (!a || !b) {
      row.status = a ? "removed" : "added";
      if (unit.isPage) (a ? pages.removed : pages.added).push(unit.pageUrl);
      continue;
    }
    if (a.unavailable || b.unavailable || !a.doc || !b.doc) {
      row.status = "not-comparable";
      row.reason = b.unavailable ? `Later run: ${b.unavailable}` : `Earlier run: ${a.unavailable ?? "no result"}`;
      if (unit.isPage) pages.notComparable.push({ url: unit.pageUrl, reason: row.reason });
      continue;
    }
    if (unit.isPage) pages.compared++;

    const beforeIssues = toIssues(a.doc, a.pageUrl, ALL_CONTENTS);
    const afterIssues = toIssues(b.doc, b.pageUrl, ALL_CONTENTS);
    const beforeById = new Map(beforeIssues.map((i) => [i.id, i]));
    const afterIds = new Set(afterIssues.map((i) => i.id));
    for (const i of afterIssues) {
      const old = beforeById.get(i.id);
      if (old) {
        row.unchanged++;
        if (old.severity !== i.severity) totals.severityChanged++;
        issues.push(toCompareIssue(i, "unchanged", old));
      } else {
        row.new++;
        issues.push(toCompareIssue(i, "new"));
      }
    }
    for (const i of beforeIssues) {
      if (afterIds.has(i.id)) continue;
      row.fixed++;
      issues.push(toCompareIssue(i, "fixed"));
    }
    totals.new += row.new;
    totals.fixed += row.fixed;
    totals.unchanged += row.unchanged;
  }

  const notes: string[] = [];
  const differences = optionDifferences(before.options, after.options);
  if (differences.length > 0) notes.push("The runs used different validation options, so some changes may come from the options rather than from edits to the pages.");
  if (before.summary.targetKey !== after.summary.targetKey) {
    notes.push(`The runs are of different targets (${before.summary.target} and ${after.summary.target}). Issues are matched by document URL, so most of them show as new or fixed.`);
  }
  if (before.summary.engineVersion && after.summary.engineVersion && before.summary.engineVersion !== after.summary.engineVersion) {
    notes.push(`The validator version changed (${before.summary.engineVersion} → ${after.summary.engineVersion}); its messages may differ.`);
  }
  if (totals.severityChanged > 0) notes.push(`${totals.severityChanged} unchanged issue(s) changed severity between the runs (shown as “before → after”).`);
  for (const [label, s] of [["earlier", before.summary], ["later", after.summary]] as const) {
    if (s.status !== "done") notes.push(`The ${label} run was ${s.status === "running" ? "still running" : s.status}; pages it didn't finish are not comparable.`);
  }
  if (before.summary.kind === "bulk") notes.push("A stylesheet linked from many pages is compared and counted once.");
  if (before.summary.inputType !== after.summary.inputType) {
    notes.push(`Input types differ: ${INPUT_TYPE_LABEL[before.summary.inputType]} and ${INPUT_TYPE_LABEL[after.summary.inputType]}.`);
  }

  return {
    schema: "markuplens-compare",
    version: 1,
    generatedAt: now.toISOString(),
    kind: before.summary.kind,
    before: runInfo(before),
    after: runInfo(after),
    totals,
    pages: before.summary.kind === "bulk" ? pages : undefined,
    optionDifferences: differences,
    notes,
    documents,
    issues,
  };
}
