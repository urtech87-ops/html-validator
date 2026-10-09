import { splitExtract } from "@/lib/validation/view";
import type { Severity } from "@/lib/validation/types";
import { SEVERITY_META } from "./severity";

/**
 * The code extract vnu returns around a problem, with the exact
 * hiliteStart/hiliteLength range highlighted. Rendered as text only.
 */
export function Extract({
  extract,
  hiliteStart,
  hiliteLength,
  severity,
}: {
  extract: string;
  hiliteStart?: number;
  hiliteLength?: number;
  severity: Severity;
}) {
  const [before, hilite, after] = splitExtract(extract, hiliteStart, hiliteLength);
  return (
    <pre className="max-w-full overflow-x-auto rounded-md bg-muted/70 px-3 py-2 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">
      <code>
        {before}
        {hilite && <mark className={`rounded-sm px-0.5 ${SEVERITY_META[severity].highlight}`}>{hilite}</mark>}
        {after}
      </code>
    </pre>
  );
}
