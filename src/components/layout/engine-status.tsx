"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleX, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface HealthResponse {
  status: "ok" | "degraded";
  vnu: { ok: boolean; url: string; latencyMs: number; error?: string };
}

type State = { kind: "loading" } | { kind: "done"; data: HealthResponse } | { kind: "error"; message: string };

/** Live status of the validation engine, from GET /api/health. */
export function EngineStatus({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setState({ kind: "done", data: (await res.json()) as HealthResponse });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Request failed" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  const ok = state.kind === "done" && state.data.vnu.ok;

  if (compact) {
    const label =
      state.kind === "loading" ? "Checking engine…" : ok ? "Engine online" : "Engine offline";
    const detail =
      state.kind === "done"
        ? state.data.vnu.ok
          ? `Nu Html Checker responded in ${state.data.vnu.latencyMs} ms`
          : `${state.data.vnu.error ?? "vnu is unavailable"}. Start it with: docker compose up -d vnu`
        : state.kind === "error"
          ? state.message
          : undefined;
    return (
      <div className="flex max-w-md items-start gap-2 text-sm" aria-live="polite" data-testid="engine-status">
        {state.kind === "loading" ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : ok ? (
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="font-medium">{label}</p>
          {detail && <p className={`text-xs ${ok ? "text-muted-foreground" : "text-destructive"}`}>{detail}</p>}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => void load()} disabled={state.kind === "loading"} aria-label="Re-check engine status">
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
      <div className="flex items-start gap-3">
        {state.kind === "loading" ? (
          <Loader2 className="mt-0.5 size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : ok ? (
          <CircleCheck className="mt-0.5 size-5 text-success" aria-hidden="true" />
        ) : (
          <CircleX className="mt-0.5 size-5 text-destructive" aria-hidden="true" />
        )}
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-medium" data-testid="engine-status">
            Validation engine
            {state.kind === "loading" ? (
              <Badge variant="secondary">Checking…</Badge>
            ) : ok ? (
              <Badge className="bg-success text-success-foreground">Online</Badge>
            ) : (
              <Badge variant="destructive">Offline</Badge>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {state.kind === "loading" && "Contacting the Nu Html Checker…"}
            {state.kind === "error" && `Could not reach the app health endpoint: ${state.message}`}
            {state.kind === "done" &&
              (state.data.vnu.ok
                ? `Nu Html Checker responded in ${state.data.vnu.latencyMs} ms at ${state.data.vnu.url}`
                : `${state.data.vnu.error ?? "vnu is unavailable"} — start it with: docker compose up -d vnu`)}
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={state.kind === "loading"}>
        <RefreshCw aria-hidden="true" /> Re-check
      </Button>
    </div>
  );
}
