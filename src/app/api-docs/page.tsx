import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MAX_REPORTS_PER_RUN, MAX_SAVED_REPORT_BYTES } from "@/lib/history/types";
import { CONTENT_KEYS, REPORT_FORMATS } from "@/lib/report/types";

export const metadata: Metadata = {
  title: "API",
  description: "The MarkupLens JSON API: validate HTML, CSS and URLs, and generate reports from saved runs.",
};

const BASE = "http://127.0.0.1:3000";

function Code({ children }: { children: string }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded-md bg-muted/70 px-3 py-2 font-mono text-[12.5px] leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Endpoint({ id, method, path, children }: { id: string; method: string; path: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardContent className="space-y-3 text-sm leading-relaxed">
        <h2 className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold">
          <span className="rounded-md bg-primary px-2 py-0.5 font-mono text-xs text-primary-foreground">{method}</span>
          <code className="font-mono">{path}</code>
        </h2>
        {children}
      </CardContent>
    </Card>
  );
}

function Fields({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Field</th>
            <th scope="col" className="px-3 py-2 font-medium">Type</th>
            <th scope="col" className="px-3 py-2 font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(([field, type, meaning]) => (
            <tr key={field} className="align-top">
              <td className="px-3 py-2 font-mono text-[12.5px] whitespace-nowrap">{field}</td>
              <td className="px-3 py-2 font-mono text-[12.5px] text-muted-foreground">{type}</td>
              <td className="px-3 py-2">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:py-10">
      <section className="space-y-3">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">API</h1>
        <p className="text-muted-foreground text-pretty">
          MarkupLens has a small JSON API for scripts and CI jobs on this machine: validate a URL, HTML or CSS, then generate a report from
          the saved run. Every run is saved to <Link href="/history" className="underline underline-offset-4">History</Link> unless you ask it not to be.
        </p>
        <nav aria-label="Endpoints" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="#access" className="underline underline-offset-4">Access</a>
          <a href="#validate" className="underline underline-offset-4">POST /api/validate</a>
          <a href="#report" className="underline underline-offset-4">POST /api/report</a>
          <a href="#saved-report" className="underline underline-offset-4">GET /api/history/reports/:id</a>
          <a href="#errors" className="underline underline-offset-4">Errors</a>
        </nav>
      </section>

      <Card id="access" className="scroll-mt-20">
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <h2 className="font-heading text-lg font-semibold">Access: this machine only</h2>
          <p>
            The app listens on <code className="font-mono">127.0.0.1</code> only (<code className="font-mono">npm run dev</code> and Docker) and
            answers only requests whose <code className="font-mono">Host</code> is <code className="font-mono">localhost</code>,{" "}
            <code className="font-mono">127.0.0.1</code> or <code className="font-mono">[::1]</code> (any port). API requests sent by a web page
            from another site (an <code className="font-mono">Origin</code> header that isn&apos;t local) are refused with{" "}
            <code className="font-mono">403</code>. There are no API keys: anyone who can reach the port can use it, so don&apos;t expose it to a
            network.
          </p>
          <p>
            Base URL: <code className="font-mono">{BASE}</code> (Docker: the <code className="font-mono">APP_PORT</code> you set).
          </p>
        </CardContent>
      </Card>

      <Endpoint id="validate" method="POST" path="/api/validate">
        <p>Validate a URL (the page plus its linked stylesheets), an HTML document or a CSS stylesheet. Returns the normalised results.</p>
        <Fields
          rows={[
            ["type", '"url" | "html" | "css"', "What value is."],
            ["value", "string", "The URL (max 2048 characters), or the HTML/CSS text (max 5 MB, UTF-8)."],
            ["fragment", "boolean", "HTML only: wrap the input in a minimal HTML5 page; line numbers still refer to your input. Default false."],
            ["save", "boolean", "Save the run to history. Default true. With false there is no runId."],
            ["options", "object", "Validation options; anything left out uses the default below."],
          ]}
        />
        <p className="font-medium">Options (defaults shown)</p>
        <Code>{`{
  "encoding": { "override": "auto", "onlyIfMissing": false },   // or "utf-8", "windows-1256", …
  "validateErrorPages": false,   // validate 4xx/5xx pages instead of reporting the status
  "verbose": false,              // keep info messages
  "userAgent": "browser",        // "browser" | "googlebot" | "mobile" (URL fetches)
  "css": { "warningLevel": "normal", "vendorPrefixes": "ignore" },  // "none"|"normal"|"more"|"all"; "warn"|"ignore"
  "grouping": "sequential", "showSource": true, "showOutline": true, "imageReport": true   // display only
}`}</Code>
        <p className="font-medium">Example</p>
        <Code>{`curl -s ${BASE}/api/validate \\
  -H "Content-Type: application/json" \\
  -d '{"type":"html","value":"<!DOCTYPE html><title>x</title><p>Hi</p>"}'`}</Code>
        <p className="font-medium">Response (shortened)</p>
        <Code>{`{
  "runId": "6f0c…",          // history id; use it with POST /api/report
  "id": "6f0c…", "createdAt": "2026-10-10T09:30:00.000Z",
  "input": { "type": "html", "target": "Direct input", "fragment": false },
  "score": 95, "passed": true, "counts": { "errors": 0, "warnings": 1, "info": 0 },
  "engineVersion": "26.10.7 (8049d4d)", "durationMs": 182,
  "documents": [{
    "id": "direct", "label": "Direct input", "kind": "html", "score": 95, "passed": true,
    "counts": { … },
    "messages": [{ "severity": "warning", "category": "html", "message": "…", "firstLine": 1, "firstColumn": 26, "extract": "…" }],
    "structure": { "checks": [ … ], "outline": [ … ], "images": [ … ] }
  }]
}`}</Code>
        <p>
          Score = <code className="font-mono">max(0, 100 − 5 × errors − 1 × warnings)</code>; a run passes when it has no errors. If the run
          can&apos;t be saved, the results are still returned with <code className="font-mono">saveError</code> instead of{" "}
          <code className="font-mono">runId</code>. Files are validated with <code className="font-mono">POST /api/validate/upload</code>{" "}
          (multipart: one or more <code className="font-mono">files</code>, an <code className="font-mono">options</code> JSON string and
          optionally <code className="font-mono">save=false</code>), which answers the same way.
        </p>
      </Endpoint>

      <Endpoint id="report" method="POST" path="/api/report">
        <p>Generate a report for a saved run and download it. The file is also saved with the run in history.</p>
        <Fields
          rows={[
            ["runId", "string", "The runId from /api/validate (or a run id from History)."],
            ["format", REPORT_FORMATS.map((f) => `"${f}"`).join(" | "), "Report format."],
            ["contents", "object", `Booleans: ${CONTENT_KEYS.join(", ")}. All true by default, except info, which follows the run's Verbose option.`],
            ["branding", "object", "Optional: project, preparedBy (max 120 characters each), reportDate (YYYY-MM-DD, default today), logo (data: URL of a PNG, JPEG or WebP up to 1 MB)."],
          ]}
        />
        <Code>{`curl -s ${BASE}/api/report \\
  -H "Content-Type: application/json" \\
  -d '{"runId":"6f0c…","format":"pdf","branding":{"project":"Acme website"}}' \\
  -D headers.txt -o report.pdf`}</Code>
        <p>
          The response is the file, with a <code className="font-mono">Content-Disposition</code> download name and an{" "}
          <code className="font-mono">X-Report-Id</code> header: the saved report&apos;s id. Each run keeps its newest {MAX_REPORTS_PER_RUN} reports;
          a report over {MAX_SAVED_REPORT_BYTES / 1024 / 1024} MB is returned but not saved (then{" "}
          <code className="font-mono">X-Report-Not-Saved</code> says why). A run that is still in progress answers{" "}
          <code className="font-mono">409</code>, an unknown runId <code className="font-mono">404</code>.
        </p>
      </Endpoint>

      <Endpoint id="saved-report" method="GET" path="/api/history/reports/:id">
        <p>
          Download a saved report again, using the id from <code className="font-mono">X-Report-Id</code> (or the Download button in History).
        </p>
        <Code>{`curl -s ${BASE}/api/history/reports/2b9e… -OJ`}</Code>
      </Endpoint>

      <Card id="errors" className="scroll-mt-20">
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <h2 className="font-heading text-lg font-semibold">Errors</h2>
          <p>
            Errors are JSON: <code className="font-mono">{`{ "error": "…" }`}</code> with status <code className="font-mono">400</code> (bad
            request), <code className="font-mono">403</code> (not a local request), <code className="font-mono">404</code> (unknown run or
            report), <code className="font-mono">413</code> (input too large), <code className="font-mono">503</code> (PDF renderer or history
            database unavailable). A page that can&apos;t be fetched is not an HTTP error: the run comes back with the document&apos;s{" "}
            <code className="font-mono">fatal</code> reason.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
