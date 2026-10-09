"use client";

import { memo } from "react";
import { Code2, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatLocation } from "@/lib/validation/view";
import type { ValidationMessage } from "@/lib/validation/types";
import { Extract } from "./extract";
import { SEVERITY_META, SeverityIcon } from "./severity";

const CATEGORY_LABEL = { html: "HTML", css: "CSS", document: "Document" } as const;

export interface MessageCardProps {
  message: ValidationMessage;
  highlighted?: boolean;
  /** Hide the message text (inside a group, where the group header shows it). */
  compact?: boolean;
  onJumpToSource?: (line: number) => void;
  onHide?: (text: string) => void;
}

export const MessageCard = memo(function MessageCard({ message: m, highlighted, compact, onJumpToSource, onHide }: MessageCardProps) {
  const meta = SEVERITY_META[m.severity];
  const location = formatLocation(m);
  const line = m.firstLine ?? m.lastLine;

  return (
    <article
      id={`msg-${m.id}`}
      data-line={line}
      tabIndex={-1}
      aria-label={`${meta.label}${location ? `, ${location}` : ""}: ${m.message}`}
      className={`scroll-mt-24 rounded-lg border border-l-4 ${meta.border} bg-card p-3 outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-4 ${
        highlighted ? "ring-3 ring-ring/60" : ""
      }`}
    >
      <div className="flex items-start gap-2.5">
        {!compact && <SeverityIcon severity={m.severity} className="mt-0.5 size-4.5" />}
        <div className="min-w-0 flex-1 space-y-2">
          {!compact && <p className="leading-snug font-medium text-pretty break-words">{m.message}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
            {location && <span className="tabular-nums">{location}</span>}
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
              {CATEGORY_LABEL[m.category]}
            </Badge>
            {m.source === "markuplens" && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]" title="Reported by MarkupLens, not by the Nu Html Checker">
                MarkupLens check
              </Badge>
            )}
          </div>
          {m.extract && <Extract extract={m.extract} hiliteStart={m.hiliteStart} hiliteLength={m.hiliteLength} severity={m.severity} />}
          {(onJumpToSource || onHide) && (
            <div className="flex flex-wrap gap-1">
              {onJumpToSource && line !== undefined && (
                <Button variant="ghost" size="xs" onClick={() => onJumpToSource(line)}>
                  <Code2 aria-hidden="true" /> Jump to source
                </Button>
              )}
              {onHide && (
                <Button variant="ghost" size="xs" onClick={() => onHide(m.message)}>
                  <EyeOff aria-hidden="true" /> Hide messages like this
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
});
