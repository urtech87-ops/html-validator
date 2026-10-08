import { CircleCheck, CircleX } from "lucide-react";
import { formatMs, plural } from "@/lib/format";
import type { MessageCounts } from "@/lib/validation/types";
import { SEVERITY_META } from "./severity";

/** Circular 0–100 score gauge. */
export function ScoreGauge({ score, size = 76 }: { score: number; size?: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const color = score >= 90 ? "text-success" : score >= 60 ? "text-warning-foreground" : "text-destructive";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 76 76" width={size} height={size} aria-hidden="true" className="-rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          className={color}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl leading-none font-semibold tabular-nums">{score}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

export function PassBadge({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-0.5 text-sm font-semibold text-success-foreground">
      <CircleCheck className="size-4" aria-hidden="true" /> Passed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-0.5 text-sm font-semibold text-white dark:text-background">
      <CircleX className="size-4" aria-hidden="true" /> Failed
    </span>
  );
}

export function CountPills({ counts }: { counts: MessageCounts }) {
  const items = [
    { key: "error" as const, n: counts.errors },
    { key: "warning" as const, n: counts.warnings },
    { key: "info" as const, n: counts.info },
  ];
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Message counts">
      {items.map(({ key, n }) => {
        const meta = SEVERITY_META[key];
        return (
          <li key={key} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${meta.soft}`}>
            <meta.Icon className={`size-4 ${meta.text}`} aria-hidden="true" />
            <span className="font-semibold tabular-nums">{n.toLocaleString("en")}</span>
            <span className="text-muted-foreground">{n === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function RunSummary({
  title,
  score,
  passed,
  counts,
  documents,
  durationMs,
  engineVersion,
}: {
  title: string;
  score: number;
  passed: boolean;
  counts: MessageCounts;
  documents: number;
  durationMs: number;
  engineVersion?: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <ScoreGauge score={score} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PassBadge passed={passed} />
          <h2 id="results-heading" tabIndex={-1} className="min-w-0 truncate font-heading text-lg font-semibold outline-none" title={title}>
            {title}
          </h2>
        </div>
        <CountPills counts={counts} />
        <p className="text-xs text-muted-foreground">
          {plural(documents, "document")} checked in {formatMs(durationMs)}
          {engineVersion ? ` · Nu Html Checker ${engineVersion}` : ""} · Score = 100 − 5 × errors − 1 × warnings
        </p>
      </div>
    </div>
  );
}
