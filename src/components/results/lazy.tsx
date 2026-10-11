"use client";

/**
 * The results view and the report dialog only appear once a run has finished,
 * so the Validate and Bulk pages load them on demand (they are about a third
 * of those pages' JavaScript). preloadResultsUi() starts the download when a
 * run starts, so they are normally ready before the results arrive.
 */
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const loadResultsView = () => import("./results-view");
const loadReportDialog = () => import("@/components/report/report-dialog");

export function preloadResultsUi() {
  void loadResultsView();
  void loadReportDialog();
}

export const ResultsView = dynamic(() => loadResultsView().then((m) => m.ResultsView), {
  ssr: false,
  loading: () => (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading results…
    </p>
  ),
});

export const ReportDialog = dynamic(() => loadReportDialog().then((m) => m.ReportDialog), { ssr: false });
