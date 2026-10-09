import { computeScore, countMessages, sumCounts } from "@/lib/validation/score";
import type { MessageCounts, RunResult, Severity } from "@/lib/validation/types";
import type { PageStatus } from "./types";

/** Client-side state of one page in a bulk run. */
export interface BulkPage {
  index: number;
  url: string;
  status: PageStatus;
  run?: RunResult;
  error?: string;
}

export interface CommonIssue {
  message: string;
  severity: Severity;
  /** Number of pages the message appears on. */
  pages: number;
  /** Total occurrences across the site (shared stylesheets counted once). */
  occurrences: number;
}

export interface BulkSummary {
  total: number;
  finished: number;
  byStatus: Record<PageStatus, number>;
  passed: number;
  failed: number;
  /** Pages that could not be validated (fetch failed, HTTP error, blocked). */
  notValidated: number;
  /**
   * Site-wide message counts. A stylesheet linked from many pages is counted
   * once (the per-page numbers in the table still include it).
   */
  counts: MessageCounts;
  /** Mean of per-page scores over validated pages. */
  averageScore?: number;
  /** Score over all messages site-wide (same formula as a single page). */
  siteScore?: number;
  commonIssues: CommonIssue[];
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Totals and "most common issues site-wide" for a bulk run (pure). */
export function summarizeBulk(pages: BulkPage[], topN = 10): BulkSummary {
  const byStatus: Record<PageStatus, number> = { queued: 0, running: 0, done: 0, error: 0, cancelled: 0 };
  for (const p of pages) byStatus[p.status]++;

  const done = pages.filter((p) => p.status === "done" && p.run);
  const validated = done.filter((p) => !p.run!.documents[0]?.fatal);
  const issues = new Map<string, CommonIssue>();
  // Shared stylesheets appear in many page runs; count their messages once site-wide.
  const seenDocs = new Set<string>();
  const siteCounts: MessageCounts[] = [];

  for (const p of validated) {
    const seenOnPage = new Set<string>();
    for (const doc of p.run!.documents) {
      if (doc.fatal) continue;
      const docKey = doc.origin === "stylesheet" && doc.url ? `css:${doc.url}` : `page:${p.index}:${doc.id}`;
      const firstTime = !seenDocs.has(docKey);
      seenDocs.add(docKey);
      if (firstTime) siteCounts.push(countMessages(doc.messages));
      for (const m of doc.messages) {
        const key = `${m.severity}\u0000${m.message}`;
        const issue = issues.get(key) ?? { message: m.message, severity: m.severity, pages: 0, occurrences: 0 };
        if (firstTime) issue.occurrences++;
        if (!seenOnPage.has(key)) {
          issue.pages++;
          seenOnPage.add(key);
        }
        issues.set(key, issue);
      }
    }
  }

  const counts = sumCounts(siteCounts);
  const commonIssues = [...issues.values()]
    .sort((a, b) => b.pages - a.pages || b.occurrences - a.occurrences || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, topN);

  return {
    total: pages.length,
    finished: byStatus.done + byStatus.error + byStatus.cancelled,
    byStatus,
    passed: validated.filter((p) => p.run!.passed).length,
    failed: validated.filter((p) => !p.run!.passed).length,
    notValidated: done.length - validated.length + byStatus.error,
    counts,
    averageScore: validated.length ? Math.round(validated.reduce((s, p) => s + p.run!.score, 0) / validated.length) : undefined,
    siteScore: validated.length ? computeScore(counts) : undefined,
    commonIssues,
  };
}
