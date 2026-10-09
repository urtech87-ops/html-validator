"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { matchGuide } from "@/lib/guide/messageGuide";
import { groupMessages, sortMessages, type SortOrder } from "@/lib/validation/view";
import type { ValidationMessage } from "@/lib/validation/types";
import { GuidePanel } from "./guide-panel";
import { MessageCard } from "./message-card";
import { SEVERITY_META, SeverityIcon } from "./severity";

const PAGE_SIZE = 200;

interface ListProps {
  messages: ValidationMessage[];
  order: SortOrder;
  grouped: boolean;
  highlightedId?: string;
  /** Group keys forced open (e.g. after clicking a gutter marker). */
  openGroups: Set<string>;
  onToggleGroup: (key: string, open: boolean) => void;
  onJumpToSource?: (line: number) => void;
  onHide: (text: string) => void;
}

export function MessageList(props: ListProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { messages, order, grouped } = props;

  if (messages.length === 0) return null;

  if (grouped) {
    const groups = groupMessages(messages, order);
    // Always render far enough to include the highlighted message (gutter clicks).
    const target = groups.findIndex((g) => g.items.some((m) => m.id === props.highlightedId));
    const shown = groups.slice(0, Math.max(limit, target + 1));
    return (
      <div className="space-y-2">
        <ul className="space-y-2" aria-label="Grouped messages">
          {shown.map((g) => {
            const open = props.openGroups.has(g.key);
            const meta = SEVERITY_META[g.severity];
            return (
              <li key={`${g.severity}:${g.key}`} className={`rounded-lg border border-l-4 ${meta.border} bg-card`}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2.5 rounded-lg p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-4"
                  aria-expanded={open}
                  onClick={() => props.onToggleGroup(g.key, !open)}
                >
                  <ChevronRight className={`mt-0.5 size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
                  <SeverityIcon severity={g.severity} className="mt-0.5 size-4.5" />
                  <span className="min-w-0 flex-1 leading-snug font-medium break-words">{g.key}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${meta.soft} ${meta.text}`}
                    aria-label={`${g.items.length} occurrences`}
                  >
                    ×{g.items.length}
                  </span>
                </button>
                {open && matchGuide(g.key) && (
                  <div className="border-t px-3 pt-2 sm:px-4">
                    <GuidePanel guide={matchGuide(g.key)!} />
                  </div>
                )}
                {open && (
                  <ul className="space-y-2 border-t p-2 sm:p-3">
                    {g.items.map((m) => (
                      <li key={m.id}>
                        <MessageCard
                          message={m}
                          compact
                          highlighted={m.id === props.highlightedId}
                          onJumpToSource={props.onJumpToSource}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <ShowMore shown={shown.length} total={groups.length} onMore={() => setLimit(limit + PAGE_SIZE)} noun="groups" />
      </div>
    );
  }

  const sorted = sortMessages(messages, order);
  const target = sorted.findIndex((m) => m.id === props.highlightedId);
  const shown = sorted.slice(0, Math.max(limit, target + 1));
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label="Messages">
        {shown.map((m) => (
          <li key={m.id}>
            <MessageCard
              message={m}
              highlighted={m.id === props.highlightedId}
              onJumpToSource={props.onJumpToSource}
              onHide={props.onHide}
            />
          </li>
        ))}
      </ul>
      <ShowMore shown={shown.length} total={sorted.length} onMore={() => setLimit(limit + PAGE_SIZE)} noun="messages" />
    </div>
  );
}

function ShowMore({ shown, total, onMore, noun }: { shown: number; total: number; onMore: () => void; noun: string }) {
  if (shown >= total) return null;
  return (
    <div className="flex items-center justify-center gap-3 py-2 text-sm text-muted-foreground">
      Showing {shown.toLocaleString("en")} of {total.toLocaleString("en")} {noun}
      <Button variant="outline" size="sm" onClick={onMore}>
        Show more
      </Button>
    </div>
  );
}
