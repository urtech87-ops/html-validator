"use client";

import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CheckStatus, StructureCheck, StructureReport } from "@/lib/validation/types";

export const CHECK_META: Record<CheckStatus, { label: string; Icon: LucideIcon; text: string; border: string; soft: string }> = {
  pass: { label: "Pass", Icon: CircleCheck, text: "text-success", border: "border-l-success", soft: "bg-success/10" },
  warning: { label: "Warning", Icon: TriangleAlert, text: "text-warning-foreground", border: "border-l-warning", soft: "bg-warning/12" },
  fail: { label: "Fail", Icon: CircleX, text: "text-destructive", border: "border-l-destructive", soft: "bg-destructive/8" },
};

const ORDER: Record<CheckStatus, number> = { fail: 0, warning: 1, pass: 2 };

export function StatusIcon({ status, className = "size-4.5" }: { status: CheckStatus; className?: string }) {
  const { Icon, text, label } = CHECK_META[status];
  return <Icon className={`${text} ${className} shrink-0`} role="img" aria-label={label} />;
}

export function CheckCounts({ counts }: { counts: StructureReport["counts"] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Check results">
      {(["fail", "warning", "pass"] as const).map((s) => {
        const meta = CHECK_META[s];
        return (
          <li key={s} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${meta.soft}`}>
            <meta.Icon className={`size-4 ${meta.text}`} aria-hidden="true" />
            <span className="font-semibold tabular-nums">{counts[s]}</span>
            <span className="text-muted-foreground">{s === "pass" ? "passed" : s === "fail" ? "failed" : counts[s] === 1 ? "warning" : "warnings"}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Structure & best-practice checks: pass / warning / fail, failures first. */
export function StructureView({ report, onJumpToSource }: { report: StructureReport; onJumpToSource?: (line: number) => void }) {
  const checks = [...report.checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CheckCounts counts={report.counts} />
        <p className="text-xs text-muted-foreground">Checked on the parsed page, independently of the Nu Html Checker. Not part of the score.</p>
      </div>
      {report.scope === "fragment" && (
        <p className="rounded-md bg-info/8 px-3 py-2 text-sm">
          This is a fragment, so page-level checks (title, meta tags, language and direction, landmarks, single h1) are skipped.
        </p>
      )}
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.id}>
            <CheckCard check={c} onJumpToSource={onJumpToSource} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckCard({ check: c, onJumpToSource }: { check: StructureCheck; onJumpToSource?: (line: number) => void }) {
  const meta = CHECK_META[c.status];
  const hasMore = (c.details?.length ?? 0) > 0 || (c.locations?.length ?? 0) > 0;
  const body = (
    <>
      {c.details && c.details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {c.details.map((d) => (
            <li key={d} className="break-words">
              {d}
            </li>
          ))}
        </ul>
      )}
      {c.locations && c.locations.length > 0 && (
        <div className="space-y-1">
          <ul className="flex flex-wrap gap-1.5" aria-label="Affected elements">
            {c.locations.map((loc, i) => (
              <li key={`${loc.line}:${i}`}>
                {onJumpToSource ? (
                  <Button variant="outline" size="xs" className="max-w-72 font-mono" onClick={() => onJumpToSource(loc.line)} title={`Jump to line ${loc.line}`}>
                    <span className="tabular-nums">L{loc.line}</span>
                    <span className="truncate">{loc.label}</span>
                  </Button>
                ) : (
                  <span className="inline-flex max-w-72 gap-1 rounded-md border px-2 py-0.5 font-mono text-xs">
                    <span className="tabular-nums">L{loc.line}</span>
                    <span className="truncate">{loc.label}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {c.affected !== undefined && c.affected > c.locations.length && (
            <p className="text-xs text-muted-foreground">
              Showing {c.locations.length} of {c.affected} elements.
            </p>
          )}
        </div>
      )}
    </>
  );

  return (
    <article className={`rounded-lg border border-l-4 ${meta.border} bg-card p-3 sm:p-4`} aria-label={`${meta.label}: ${c.title}`}>
      <div className="flex items-start gap-2.5">
        <StatusIcon status={c.status} className="mt-0.5 size-4.5" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h4 className="font-medium">{c.title}</h4>
            <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
          </div>
          <p className="text-sm text-pretty break-words">{c.explanation}</p>
          {hasMore &&
            (c.status === "pass" ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Details</summary>
                <div className="mt-2 space-y-2">{body}</div>
              </details>
            ) : (
              body
            ))}
        </div>
      </div>
    </article>
  );
}
