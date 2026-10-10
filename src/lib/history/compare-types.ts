/**
 * Run comparison result (client-safe types). Built by compare.ts.
 */
import type { DocumentKind, MessageCategory, MessageCounts, Severity } from "@/lib/validation/types";
import type { RunInputType, RunKind, RunStatus } from "./types";

export type IssueChange = "new" | "fixed" | "unchanged";

export const CHANGE_LABEL: Record<IssueChange, string> = { new: "New", fixed: "Fixed", unchanged: "Unchanged" };

export interface CompareIssue {
  /** Same Issue ID as the Excel report (with -2, -3 suffixes for duplicates in one document). */
  id: string;
  change: IssueChange;
  /** The page validated (for a shared stylesheet: the first page linking it). */
  pageUrl: string;
  document: string;
  documentKind: DocumentKind;
  severityBefore?: Severity;
  severityAfter?: Severity;
  category: MessageCategory;
  message: string;
  /** Line in the later run (in the earlier run for fixed issues). */
  line?: number;
  column?: number;
  extract?: string;
  hiliteStart?: number;
  hiliteLength?: number;
  fix?: string;
}

export type CompareDocumentStatus = "compared" | "added" | "removed" | "not-comparable";

export const DOCUMENT_STATUS_LABEL: Record<CompareDocumentStatus, string> = {
  compared: "Compared",
  added: "Only in later run",
  removed: "Only in earlier run",
  "not-comparable": "Not comparable",
};

export interface CompareDocument {
  key: string;
  pageUrl: string;
  /** URL or name of the document. */
  document: string;
  role: "page" | "stylesheet" | "file" | "direct";
  status: CompareDocumentStatus;
  /** Why it couldn't be compared (e.g. the page failed in one run). */
  reason?: string;
  scoreBefore?: number;
  scoreAfter?: number;
  new: number;
  fixed: number;
  unchanged: number;
  /** Bulk: number of pages (in the later run) linking this stylesheet. */
  linkedFrom?: number;
}

export interface CompareRunInfo {
  id: string;
  createdAt: string;
  kind: RunKind;
  inputType: RunInputType;
  target: string;
  status: RunStatus;
  /** Single: the run score. Bulk: average page score. */
  score?: number;
  counts: MessageCounts;
  pageCount: number;
  engineVersion?: string;
}

export interface OptionDifference {
  option: string;
  before: string;
  after: string;
}

export interface CompareResult {
  schema: "markuplens-compare";
  version: 1;
  generatedAt: string;
  kind: RunKind;
  /** The earlier run. */
  before: CompareRunInfo;
  /** The later run. */
  after: CompareRunInfo;
  totals: { new: number; fixed: number; unchanged: number; severityChanged: number };
  /** Bulk runs: pages matched by URL. */
  pages?: { compared: number; added: string[]; removed: string[]; notComparable: Array<{ url: string; reason: string }> };
  /** Options that change validation results and differ between the runs. */
  optionDifferences: OptionDifference[];
  notes: string[];
  documents: CompareDocument[];
  issues: CompareIssue[];
}
