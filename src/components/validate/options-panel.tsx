"use client";

import { useId, useState } from "react";
import { ChevronDown, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { regexError } from "@/lib/validation/message-filters";
import {
  DEFAULT_OPTIONS,
  ENCODINGS,
  USER_AGENTS,
  type CssWarningLevel,
  type UserAgentPreset,
  type ValidationOptions,
} from "@/lib/validation/options";
import { useMessageFilters, useOptions } from "./settings-store";

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      {children}
    </fieldset>
  );
}

function CheckboxField({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={disabled} className="mt-0.5" />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="font-normal leading-snug">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** Collapsible "More options" panel. Options persist in localStorage. */
export function OptionsPanel() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useOptions();
  const ids = { encoding: useId(), ua: useId(), level: useId() };

  const update = (patch: Partial<ValidationOptions>) => setOptions({ ...options, ...patch });
  const isDefault = JSON.stringify(options) === JSON.stringify(DEFAULT_OPTIONS);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-1" aria-controls="more-options">
            <ChevronDown className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            More options
          </Button>
        </CollapsibleTrigger>
        {!isDefault && (
          <Button variant="ghost" size="sm" onClick={() => setOptions(DEFAULT_OPTIONS)}>
            <RotateCcw aria-hidden="true" /> Reset
          </Button>
        )}
      </div>
      <CollapsibleContent id="more-options" className="border-t px-4 py-4">
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          <Fieldset legend="Character encoding">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.encoding} className="font-normal">
                Encoding
              </Label>
              <Select
                value={options.encoding.override}
                onValueChange={(v) =>
                  update({ encoding: { ...options.encoding, override: v as ValidationOptions["encoding"]["override"] } })
                }
              >
                <SelectTrigger id={ids.encoding} className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Detect automatically</SelectItem>
                  {ENCODINGS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <CheckboxField
              checked={options.encoding.onlyIfMissing}
              onChange={(v) => update({ encoding: { ...options.encoding, onlyIfMissing: v } })}
              disabled={options.encoding.override === "auto"}
              label="Only if the document doesn't declare one"
              hint="Direct input is always treated as UTF-8."
            />
          </Fieldset>

          <Fieldset legend="Results">
            <RadioGroup
              value={options.grouping}
              onValueChange={(v) => update({ grouping: v as ValidationOptions["grouping"] })}
              aria-label="Message grouping"
              className="gap-2"
            >
              <div className="flex items-center gap-2.5">
                <RadioGroupItem value="sequential" id="grouping-sequential" />
                <Label htmlFor="grouping-sequential" className="font-normal">
                  List messages sequentially
                </Label>
              </div>
              <div className="flex items-center gap-2.5">
                <RadioGroupItem value="by-type" id="grouping-by-type" />
                <Label htmlFor="grouping-by-type" className="font-normal">
                  Group identical messages
                </Label>
              </div>
            </RadioGroup>
            <CheckboxField checked={options.showSource} onChange={(v) => update({ showSource: v })} label="Show source with highlighted lines" />
            <CheckboxField
              checked={options.verbose}
              onChange={(v) => update({ verbose: v })}
              label="Verbose output"
              hint="Include informational messages."
            />
          </Fieldset>

          <Fieldset legend="Fetching (URL mode)">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.ua} className="font-normal">
                User-Agent
              </Label>
              <Select value={options.userAgent} onValueChange={(v) => update({ userAgent: v as UserAgentPreset })}>
                <SelectTrigger id={ids.ua} className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(USER_AGENTS).map(([key, ua]) => (
                    <SelectItem key={key} value={key}>
                      {ua.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <CheckboxField
              checked={options.validateErrorPages}
              onChange={(v) => update({ validateErrorPages: v })}
              label="Validate error pages"
              hint="Validate pages that return HTTP 4xx/5xx instead of reporting the status."
            />
          </Fieldset>

          <Fieldset legend="CSS">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.level} className="font-normal">
                Warning level
              </Label>
              <Select
                value={options.css.warningLevel}
                onValueChange={(v) => update({ css: { ...options.css, warningLevel: v as CssWarningLevel } })}
              >
                <SelectTrigger id={ids.level} className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No warnings</SelectItem>
                  <SelectItem value="normal">Normal report</SelectItem>
                  <SelectItem value="more">More (include CSS info)</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <RadioGroup
              value={options.css.vendorPrefixes}
              onValueChange={(v) => update({ css: { ...options.css, vendorPrefixes: v as "warn" | "ignore" } })}
              aria-label="Vendor-prefixed properties"
              className="gap-2"
            >
              <p className="text-sm" aria-hidden="true">
                Vendor-prefixed properties (-webkit-, -moz-…)
              </p>
              <div className="flex items-center gap-2.5">
                <RadioGroupItem value="ignore" id="vendor-ignore" />
                <Label htmlFor="vendor-ignore" className="font-normal">
                  Ignore
                </Label>
              </div>
              <div className="flex items-center gap-2.5">
                <RadioGroupItem value="warn" id="vendor-warn" />
                <Label htmlFor="vendor-warn" className="font-normal">
                  Treat as warnings
                </Label>
              </div>
            </RadioGroup>
          </Fieldset>

          <div className="md:col-span-2">
            <MessageFiltersEditor />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MessageFiltersEditor() {
  const [filters, setFilters] = useMessageFilters();
  const [pattern, setPattern] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const inputId = useId();
  const error = isRegex && pattern ? regexError(pattern) : undefined;

  const add = () => {
    const trimmed = pattern.trim();
    if (!trimmed || error) return;
    setFilters([...filters, { id: crypto.randomUUID(), pattern: trimmed, isRegex }]);
    setPattern("");
  };

  return (
    <Fieldset legend="Message filters">
      <p className="text-xs text-muted-foreground">
        Hide messages whose text contains a phrase or matches a regular expression. Saved in this browser.
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="grid flex-1 gap-1">
          <Label htmlFor={inputId} className="sr-only">
            Message text or pattern to hide
          </Label>
          <Input
            id={inputId}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={isRegex ? "e.g. ^Consider adding a .lang" : "e.g. Trailing slash on void elements"}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : undefined}
          />
          {error && (
            <p id={`${inputId}-error`} className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <CheckboxField checked={isRegex} onChange={setIsRegex} label="Regex" />
        <Button type="submit" variant="outline" size="sm" disabled={!pattern.trim() || !!error}>
          <Plus aria-hidden="true" /> Add filter
        </Button>
      </form>
      {filters.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Active message filters">
          {filters.map((f) => (
            <li key={f.id} className="flex max-w-full items-center gap-1 rounded-md border bg-muted/50 py-0.5 pl-2 text-xs">
              <span className="truncate font-mono">{f.isRegex ? `/${f.pattern}/i` : f.pattern}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setFilters(filters.filter((x) => x.id !== f.id))}
                aria-label={`Remove filter ${f.pattern}`}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Fieldset>
  );
}
