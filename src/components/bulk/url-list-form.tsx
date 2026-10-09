"use client";

import { useId, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_BULK_URLS } from "@/lib/bulk/types";
import { parseUrlList } from "@/lib/bulk/url-list";
import { SubmitButton } from "@/components/validate/submit-button";

/** Paste up to 200 URLs, one per line, with a live summary of what will be checked. */
export function UrlListForm({ busy, onSubmit }: { busy: boolean; onSubmit: (urls: string[]) => void }) {
  const [text, setText] = useState("");
  const id = useId();
  const parsed = useMemo(() => parseUrlList(text), [text]);
  const notes: string[] = [];
  if (parsed.duplicates) notes.push(`${parsed.duplicates} duplicate${parsed.duplicates === 1 ? "" : "s"} removed`);
  if (parsed.overLimit) notes.push(`${parsed.overLimit} over the ${MAX_BULK_URLS}-URL limit will be skipped`);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.urls.length) onSubmit(parsed.urls);
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={id}>URLs (one per line)</Label>
        <Textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={"https://example.com/\nhttps://example.com/about\nhttps://example.com/contact"}
          className="min-h-48 font-mono text-[13px] leading-relaxed"
          aria-describedby={`${id}-summary`}
        />
        <div id={`${id}-summary`} className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
          <p>
            <span className="font-semibold text-foreground">{parsed.urls.length}</span> of {MAX_BULK_URLS} URLs ready
            {notes.length ? ` · ${notes.join(" · ")}` : ""}. Lines starting with # are ignored.
          </p>
          {parsed.invalid.length > 0 && (
            <p className="text-destructive">
              Not a valid http(s) URL:{" "}
              {parsed.invalid
                .slice(0, 5)
                .map((i) => `line ${i.line} (“${i.text.slice(0, 40)}”)`)
                .join(", ")}
              {parsed.invalid.length > 5 ? ` and ${parsed.invalid.length - 5} more` : ""}.
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <SubmitButton busy={busy} disabled={parsed.urls.length === 0} label={`Validate ${parsed.urls.length || ""} page${parsed.urls.length === 1 ? "" : "s"}`.replace("  ", " ")} />
      </div>
    </form>
  );
}
