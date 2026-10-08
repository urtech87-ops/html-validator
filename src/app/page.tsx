import { FileCode2, FileUp, Globe } from "lucide-react";
import { EngineStatus } from "@/components/layout/engine-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const inputMethods = [
  { icon: Globe, title: "Validate by URL", text: "Fetch a page and check its HTML plus linked and inline CSS." },
  { icon: FileUp, title: "Upload files", text: "Check several .html, .css or .svg files in one run." },
  { icon: FileCode2, title: "Direct input", text: "Paste a full document or a fragment into the editor." },
];

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:py-14">
      <section className="max-w-2xl space-y-3">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Check your HTML and CSS
        </h1>
        <p className="text-lg text-muted-foreground text-pretty">
          MarkupLens runs your markup through the Nu Html Checker, explains every issue in plain English and
          turns the results into shareable reports.
        </p>
      </section>

      <Card>
        <CardContent>
          <EngineStatus />
        </CardContent>
      </Card>

      <section aria-labelledby="methods-heading" className="space-y-4">
        <h2 id="methods-heading" className="font-heading text-lg font-semibold">
          Ways to validate
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {inputMethods.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Card className="h-full">
                <CardHeader>
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{text}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">The validation form is added in Phase 2.</p>
      </section>
    </div>
  );
}
