"use client";

import { useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { EditorLoading } from "@/components/editor/monaco-loading";
import type { SourceMarker } from "@/components/editor/monaco";
import { useMediaQuery } from "@/components/editor/use-media-query";
import { SEVERITY_RANK } from "@/lib/validation/view";
import type { DocumentKind, Severity, ValidationMessage } from "@/lib/validation/types";
import { SEVERITY_META, SeverityIcon } from "./severity";

const MonacoSource = dynamic(() => import("@/components/editor/monaco").then((m) => m.MonacoSource), {
  ssr: false,
  loading: () => <EditorLoading height={520} />,
});

const LANGUAGE: Record<DocumentKind, "html" | "css" | "xml"> = { html: "html", xhtml: "xml", svg: "xml", css: "css" };

/** Lines rendered by the small-screen fallback before asking for a wider screen. */
const FALLBACK_MAX_LINES = 3000;

export interface SourceViewProps {
  source: string;
  kind: DocumentKind;
  messages: ValidationMessage[];
  reveal?: { line: number; nonce: number };
  onLineClick: (line: number) => void;
}

/**
 * Read-only source with gutter markers on every line that has a message.
 * Monaco from 640px up; a lightweight numbered listing on small screens.
 */
export function SourceView({ source, kind, messages, reveal, onLineClick }: SourceViewProps) {
  const wide = useMediaQuery("(min-width: 640px)", true);
  const markers = useMemo<SourceMarker[]>(
    () =>
      messages
        .filter((m) => m.lastLine !== undefined)
        .map((m) => ({
          severity: m.severity,
          message: m.message,
          firstLine: m.firstLine ?? m.lastLine!,
          firstColumn: m.firstColumn,
          lastLine: m.lastLine!,
          lastColumn: m.lastColumn,
        })),
    [messages],
  );

  if (wide) {
    return (
      <div className="overflow-hidden rounded-lg border">
        <MonacoSource value={source} language={LANGUAGE[kind]} height={520} markers={markers} reveal={reveal} onGutterClick={onLineClick} />
      </div>
    );
  }
  return <FallbackSource source={source} markers={markers} reveal={reveal} onLineClick={onLineClick} />;
}

function FallbackSource({
  source,
  markers,
  reveal,
  onLineClick,
}: {
  source: string;
  markers: SourceMarker[];
  reveal?: { line: number; nonce: number };
  onLineClick: (line: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => source.split(/\r\n|\r|\n/), [source]);
  const worst = useMemo(() => {
    const map = new Map<number, Severity>();
    for (const m of markers) {
      const current = map.get(m.lastLine);
      if (!current || SEVERITY_RANK[m.severity] < SEVERITY_RANK[current]) map.set(m.lastLine, m.severity);
    }
    return map;
  }, [markers]);

  useEffect(() => {
    if (!reveal) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-source-line="${reveal.line}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  }, [reveal]);

  const shown = lines.slice(0, FALLBACK_MAX_LINES);
  return (
    <div ref={containerRef} className="max-h-[70vh] overflow-auto rounded-lg border bg-muted/30 font-mono text-[12px] leading-5">
      <ol className="min-w-max py-2" aria-label="Source code">
        {shown.map((text, i) => {
          const line = i + 1;
          const severity = worst.get(line);
          return (
            <li
              key={line}
              data-source-line={line}
              tabIndex={-1}
              className={`flex outline-none focus:bg-primary/10 ${severity ? SEVERITY_META[severity].soft : ""}`}
            >
              <span className="sticky left-0 flex w-14 shrink-0 items-center justify-end gap-1 bg-muted/90 pr-2 text-muted-foreground select-none">
                {severity ? (
                  <button
                    type="button"
                    onClick={() => onLineClick(line)}
                    className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Show messages for line ${line}`}
                  >
                    <SeverityIcon severity={severity} className="size-3.5" />
                  </button>
                ) : null}
                <span className="tabular-nums">{line}</span>
              </span>
              <code className="pl-3 whitespace-pre">{text || " "}</code>
            </li>
          );
        })}
      </ol>
      {lines.length > FALLBACK_MAX_LINES && (
        <p className="sticky left-0 border-t p-3 font-sans text-xs text-muted-foreground">
          Showing the first {FALLBACK_MAX_LINES.toLocaleString("en")} of {lines.length.toLocaleString("en")} lines. Use a wider screen for the full source.
        </p>
      )}
    </div>
  );
}
