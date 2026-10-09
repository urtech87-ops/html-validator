"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, FileCode2, FileUp, Globe } from "lucide-react";
import { ResultsView } from "@/components/results/results-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { validateFilesRequest, validateTextRequest, validateUrlRequest } from "@/lib/client/api";
import type { ValidationOptions } from "@/lib/validation/options";
import type { RunResult } from "@/lib/validation/types";
import { DirectInputForm, type DirectInput } from "./direct-input-form";
import { OptionsPanel } from "./options-panel";
import { useOptions } from "./settings-store";
import { UploadForm } from "./upload-form";
import { UrlForm } from "./url-form";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string }
  | { kind: "done"; run: RunResult; options: ValidationOptions };

export function ValidatorApp() {
  const [options] = useOptions();
  const [state, setState] = useState<State>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const busy = state.kind === "busy";

  const run = useCallback(
    async (request: (signal: AbortSignal) => Promise<RunResult>) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      const snapshot = options;
      setState({ kind: "busy" });
      try {
        const result = await request(ac.signal);
        if (!ac.signal.aborted) setState({ kind: "done", run: result, options: snapshot });
      } catch (err) {
        if (ac.signal.aborted) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : "Validation failed." });
      }
    },
    [options],
  );

  // Move focus to the results heading when a run completes (screen readers + keyboard users).
  useEffect(() => {
    if (state.kind !== "done") return;
    const heading = document.getElementById("results-heading");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [state]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <Tabs defaultValue="url">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="url">
                <Globe aria-hidden="true" /> <span>URL</span>
              </TabsTrigger>
              <TabsTrigger value="upload">
                <FileUp aria-hidden="true" /> <span>Upload</span>
              </TabsTrigger>
              <TabsTrigger value="direct">
                <FileCode2 aria-hidden="true" /> <span>Direct input</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="url" className="pt-3">
              <UrlForm busy={busy} onSubmit={(url) => run((signal) => validateUrlRequest(url, options, signal))} />
            </TabsContent>
            <TabsContent value="upload" className="pt-3">
              <UploadForm busy={busy} onSubmit={(files) => run((signal) => validateFilesRequest(files, options, signal))} />
            </TabsContent>
            <TabsContent value="direct" className="pt-3">
              <DirectInputForm
                busy={busy}
                onSubmit={(input: DirectInput) =>
                  run((signal) => validateTextRequest(input.language, input.value, input.fragment, options, signal))
                }
              />
            </TabsContent>
          </Tabs>
          <OptionsPanel />
        </CardContent>
      </Card>

      <div aria-live="polite" className="sr-only">
        {busy ? "Validating…" : state.kind === "done" ? "Validation finished." : ""}
      </div>

      {state.kind === "error" && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Validation failed</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      {state.kind === "done" && <ResultsView key={state.run.id} run={state.run} options={state.options} />}
    </div>
  );
}
