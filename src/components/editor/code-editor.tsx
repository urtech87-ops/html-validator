"use client";

import dynamic from "next/dynamic";
import { Textarea } from "@/components/ui/textarea";
import { EditorLoading } from "./monaco-loading";
import { useMediaQuery } from "./use-media-query";

const MonacoInput = dynamic(() => import("./monaco").then((m) => m.MonacoInput), {
  ssr: false,
  loading: () => <EditorLoading height={320} />,
});

export interface CodeEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  language: "html" | "css";
  ariaLabel: string;
  onSubmit?: () => void;
}

/**
 * Direct-input editor: Monaco (lazy-loaded) from 640px up, a plain textarea
 * below that, where Monaco is hard to use on touch screens.
 */
export function CodeEditor({ id, value, onChange, language, ariaLabel, onSubmit }: CodeEditorProps) {
  const wide = useMediaQuery("(min-width: 640px)", true);

  if (!wide) {
    return (
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSubmit?.();
          }
        }}
        aria-label={ariaLabel}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="min-h-64 font-mono text-[13px] leading-relaxed"
        placeholder={language === "html" ? "<!DOCTYPE html>…" : "body { … }"}
      />
    );
  }

  return (
    <div id={id} className="overflow-hidden rounded-md border">
      <MonacoInput value={value} onChange={onChange} language={language} height={320} ariaLabel={ariaLabel} onSubmit={onSubmit} />
    </div>
  );
}
