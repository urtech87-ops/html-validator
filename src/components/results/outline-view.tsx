"use client";

import { Button } from "@/components/ui/button";
import type { OutlineHeading } from "@/lib/validation/types";

const ISSUE_LABEL: Record<OutlineHeading["issues"][number], string> = {
  "skipped-level": "Skipped level",
  empty: "Empty",
  "extra-h1": "Extra h1",
};

/** Heading tree (h1–h6), indented by level, with skipped levels and h1 problems flagged. */
export function OutlineView({
  outline,
  fragment,
  onJumpToSource,
}: {
  outline: OutlineHeading[];
  fragment: boolean;
  onJumpToSource?: (line: number) => void;
}) {
  const h1 = outline.filter((h) => h.level === 1).length;
  const skipped = outline.filter((h) => h.issues.includes("skipped-level")).length;
  const empty = outline.filter((h) => h.issues.includes("empty")).length;

  const summary: Array<{ text: string; bad: boolean }> = [
    { text: `${outline.length} heading${outline.length === 1 ? "" : "s"}`, bad: false },
  ];
  if (!fragment) summary.push({ text: h1 === 0 ? "No h1" : h1 === 1 ? "One h1" : `${h1} h1 elements`, bad: h1 !== 1 });
  if (skipped) summary.push({ text: `${skipped} skipped level${skipped === 1 ? "" : "s"}`, bad: true });
  if (empty) summary.push({ text: `${empty} empty`, bad: true });

  if (outline.length === 0) {
    return <p className="text-sm text-muted-foreground">{fragment ? "This fragment has no headings." : "This page has no headings (h1–h6)."}</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2 text-sm" aria-label="Outline summary">
        {summary.map((s) => (
          <li key={s.text} className={`rounded-md px-2 py-1 ${s.bad ? "bg-warning/15 font-medium text-warning-foreground" : "bg-muted"}`}>
            {s.text}
          </li>
        ))}
      </ul>
      <ol className="rounded-lg border p-2 sm:p-3" aria-label="Heading outline">
        {outline.map((h, i) => (
          <li
            key={`${h.line ?? "x"}-${i}`}
            className={`flex items-start gap-2 rounded-md py-1 pr-2 text-sm ${h.issues.length ? "bg-warning/10" : ""}`}
            style={{ paddingLeft: `calc(${Math.min(h.level - 1, 5)} * 1.25rem + 0.5rem)` }}
          >
            <span
              className={`mt-0.5 shrink-0 rounded px-1 font-mono text-[11px] font-semibold ${
                h.level === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
              aria-label={`Heading level ${h.level}`}
            >
              H{h.level}
            </span>
            <span className={`min-w-0 flex-1 break-words ${h.text ? "" : "italic text-muted-foreground"}`}>{h.text || "(empty heading)"}</span>
            {h.issues.map((issue) => (
              <span
                key={issue}
                className="shrink-0 rounded bg-warning/25 px-1.5 py-0.5 text-[11px] font-semibold text-warning-foreground"
                title={issue === "skipped-level" && h.previousLevel ? `Follows an h${h.previousLevel}` : undefined}
              >
                {ISSUE_LABEL[issue]}
                {issue === "skipped-level" && h.previousLevel ? ` (h${h.previousLevel}→h${h.level})` : ""}
              </span>
            ))}
            {h.line !== undefined && onJumpToSource && (
              <Button variant="ghost" size="xs" className="shrink-0 tabular-nums" onClick={() => onJumpToSource(h.line!)} aria-label={`Jump to line ${h.line}`}>
                L{h.line}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
