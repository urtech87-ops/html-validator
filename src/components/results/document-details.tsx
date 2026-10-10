import { CircleAlert, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatBytes, formatMs } from "@/lib/format";
import type { DocumentResult, EncodingSource } from "@/lib/validation/types";

const ENCODING_SOURCE: Record<EncodingSource, string> = {
  bom: "byte order mark",
  "http-header": "HTTP header",
  meta: "<meta> tag",
  "css-charset": "@charset rule",
  override: "your override",
  "direct-input": "direct input",
  fallback: "not declared — detected",
};

/** Facts about one document: size, doctype, encoding, HTTP status, timings, notices. */
export function DocumentDetails({ doc }: { doc: DocumentResult }) {
  const facts: Array<[string, string]> = [
    ["Type", doc.kind.toUpperCase()],
    ["Size", doc.fatal && doc.sizeBytes === 0 ? "—" : formatBytes(doc.sizeBytes)],
    ["Doctype", doc.doctype.label],
    ["Encoding", doc.encoding.name === "—" ? "—" : `${doc.encoding.name} (${ENCODING_SOURCE[doc.encoding.source]})`],
  ];
  if (doc.httpStatus !== undefined) facts.push(["HTTP status", String(doc.httpStatus)]);
  if (doc.fetchMs !== undefined) facts.push(["Fetch time", formatMs(doc.fetchMs)]);
  if (doc.validateMs !== undefined) facts.push(["Validation time", formatMs(doc.validateMs)]);
  if (doc.inlineStyleBlocks !== undefined) facts.push(["Inline <style> blocks", String(doc.inlineStyleBlocks)]);

  return (
    <div className="space-y-3">
      {doc.fatal && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Could not validate this document</AlertTitle>
          <AlertDescription className="break-words">{doc.fatal}</AlertDescription>
        </Alert>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate font-medium" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {doc.sourceOmitted && (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          The source of this document wasn&apos;t kept: bulk runs leave out documents over 300 KB, and saved runs keep at most
          10 MB of sources. Validate it again on its own to see it.
        </p>
      )}
      {doc.notices.length > 0 && (
        <ul className="space-y-1.5">
          {doc.notices.map((n) => (
            <li key={n} className="flex items-start gap-2 rounded-md bg-info/8 px-3 py-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
              <span className="break-words">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {doc.kind === "html" && doc.inlineStyleBlocks !== undefined && doc.inlineStyleBlocks > 0 && (
        <p className="text-xs text-muted-foreground">
          CSS in inline &lt;style&gt; blocks and style attributes is validated together with the HTML; those messages are marked
          “CSS”.
        </p>
      )}
    </div>
  );
}
