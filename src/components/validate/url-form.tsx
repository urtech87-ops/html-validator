"use client";

import { useId, useState } from "react";
import { Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "./submit-button";

export function UrlForm({ busy, onSubmit }: { busy: boolean; onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const id = useId();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onSubmit(url.trim());
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Page address</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Globe className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id={id}
              type="text"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              placeholder="https://example.com/"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-9 pl-8"
              aria-describedby={`${id}-hint`}
              required
            />
          </div>
          <SubmitButton busy={busy} disabled={!url.trim()} />
        </div>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          The page is fetched by MarkupLens (up to 5 redirects). Linked stylesheets are validated as CSS too.
        </p>
      </div>
    </form>
  );
}
