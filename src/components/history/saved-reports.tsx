"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Download, FileText, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { deleteReportRequest } from "@/lib/client/history-client";
import { formatBytes } from "@/lib/format";
import { MAX_REPORTS_PER_RUN, type SavedReportRow } from "@/lib/history/types";
import { FORMAT_META, type ReportFormat } from "@/lib/report/types";
import { LocalTime } from "./local-time";

/** Reports saved with a run: download again or delete. */
export function SavedReports({ reports }: { reports: SavedReportRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold">Saved reports</h2>
          <p className="text-xs text-muted-foreground">The newest {MAX_REPORTS_PER_RUN} reports of a run are kept.</p>
        </div>
        {error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reports yet. Reports you generate from this run are saved here.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={r.filename}>
                  {r.filename}
                </span>
                <span className="text-xs text-muted-foreground">
                  {FORMAT_META[r.format as ReportFormat]?.label.split(" ")[0] ?? r.format} · {formatBytes(r.sizeBytes)} · <LocalTime iso={r.createdAt} />
                </span>
                <span className="flex gap-1">
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/history/reports/${r.id}`} download={r.filename} aria-label={`Download ${r.filename}`}>
                      <Download aria-hidden="true" /> Download
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === r.id}
                    aria-label={`Delete ${r.filename}`}
                    onClick={async () => {
                      setBusy(r.id);
                      setError(undefined);
                      try {
                        await deleteReportRequest(r.id);
                        router.refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "The report could not be deleted.");
                      } finally {
                        setBusy(undefined);
                      }
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
