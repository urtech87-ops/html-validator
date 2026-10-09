"use client";

import { useId, useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GuideMatch } from "@/lib/guide/messageGuide";

/** "Explain & fix" disclosure for a message with a guide entry. */
export function GuidePanel({ guide }: { guide: GuideMatch }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <Button variant="ghost" size="xs" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Lightbulb aria-hidden="true" /> Explain &amp; fix
        <ChevronDown className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </Button>
      {open && (
        <div id={id} className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="text-pretty">{guide.explanation}</p>
          <p className="text-pretty">
            <span className="font-semibold">How to fix: </span>
            {guide.fix}
          </p>
          {guide.example && (
            <div className="grid gap-2 md:grid-cols-2">
              <CodeSample label="Before" code={guide.example.before} tone="bad" />
              <CodeSample label="After" code={guide.example.after} tone="good" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CodeSample({ label, code, tone }: { label: string; code: string; tone: "bad" | "good" }) {
  return (
    <figure className="min-w-0">
      <figcaption className={`mb-1 text-xs font-semibold ${tone === "bad" ? "text-destructive" : "text-success"}`}>{label}</figcaption>
      <pre
        className={`overflow-x-auto rounded-md border-l-4 bg-background px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all ${
          tone === "bad" ? "border-l-destructive" : "border-l-success"
        }`}
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}
