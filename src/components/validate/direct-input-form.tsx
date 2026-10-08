"use client";

import { useState } from "react";
import { CodeEditor } from "@/components/editor/code-editor";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SubmitButton } from "./submit-button";

export interface DirectInput {
  language: "html" | "css";
  fragment: boolean;
  value: string;
}

/** Make the selected option unmistakable (the default "on" tint is too subtle). */
const ITEM = "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground hover:data-[state=on]:bg-primary/90 hover:data-[state=on]:text-primary-foreground";

const SAMPLES = {
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sample page</title>
</head>
<body>
  <h1>Hello</h1>
</body>
</html>
`,
  fragment: `<nav id="menu">
  <a href="/">Home</a>
</nav>
<img src="logo.png">
`,
  css: `body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
`,
};

export function DirectInputForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: DirectInput) => void }) {
  const [language, setLanguage] = useState<"html" | "css">("html");
  const [fragment, setFragment] = useState(false);
  const [values, setValues] = useState({ html: SAMPLES.html, css: SAMPLES.css });
  const value = values[language];

  const submit = () => {
    if (value.trim()) onSubmit({ language, fragment: language === "html" && fragment, value });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" id="direct-language-label">
            Language
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={language}
            onValueChange={(v) => v && setLanguage(v as "html" | "css")}
            aria-labelledby="direct-language-label"
          >
            <ToggleGroupItem value="html" className={ITEM}>HTML</ToggleGroupItem>
            <ToggleGroupItem value="css" className={ITEM}>CSS</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {language === "html" && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" id="direct-mode-label">
              Input is
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={fragment ? "fragment" : "full"}
              onValueChange={(v) => {
                if (!v) return;
                const nextFragment = v === "fragment";
                setFragment(nextFragment);
                // Swap in a matching sample if the user hasn't typed anything of their own yet.
                if (values.html === SAMPLES.html || values.html === SAMPLES.fragment) {
                  setValues({ ...values, html: nextFragment ? SAMPLES.fragment : SAMPLES.html });
                }
              }}
              aria-labelledby="direct-mode-label"
            >
              <ToggleGroupItem value="full" className={ITEM}>Full document</ToggleGroupItem>
              <ToggleGroupItem value="fragment" className={ITEM}>Fragment</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="direct-input-editor" className="sr-only">
          {language === "html" ? "HTML source" : "CSS source"}
        </Label>
        <CodeEditor
          id="direct-input-editor"
          value={value}
          onChange={(v) => setValues({ ...values, [language]: v })}
          language={language}
          ariaLabel={language === "html" ? "HTML source to validate" : "CSS source to validate"}
          onSubmit={submit}
        />
        <p className="text-xs text-muted-foreground">
          {language === "html" && fragment
            ? "The fragment is wrapped in a minimal HTML5 page before validation; line numbers refer to your input."
            : "Tip: press Ctrl+Enter to validate."}
        </p>
      </div>

      <div className="flex justify-end">
        <SubmitButton busy={busy} disabled={!value.trim()} />
      </div>
    </form>
  );
}
