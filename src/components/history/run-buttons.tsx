"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteRunsRequest, rerunRequest } from "@/lib/client/history-client";
import type { RunSummaryRow } from "@/lib/history/types";
import { ConfirmDialog } from "./confirm-dialog";

type Size = "sm" | "default";

/** Re-run with the original input and options. Bulk runs restart on /bulk; single runs run on the server. */
export function RerunButton({ run, size = "sm", onError }: { run: RunSummaryRow; size?: Size; onError?: (message: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = (
    <>
      {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />} {busy ? "Re-running…" : "Re-run"}
    </>
  );
  if (!run.canRerun || run.status === "running") {
    return (
      <Button variant="outline" size={size} disabled title={run.status === "running" ? "The run is still in progress." : "The input of this run was too large to keep (over 10 MB)."}>
        <RotateCw aria-hidden="true" /> Re-run
      </Button>
    );
  }
  if (run.kind === "bulk") {
    return (
      <Button variant="outline" size={size} asChild>
        <Link href={`/bulk?rerun=${run.id}`} aria-label={`Re-run ${run.target}`}>
          {label}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size={size}
      disabled={busy}
      aria-label={`Re-run ${run.target}`}
      onClick={async () => {
        setBusy(true);
        try {
          const id = await rerunRequest(run.id);
          router.push(`/history/${id}`);
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "The run could not be re-run.");
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

export function DeleteRunsButton({
  ids,
  label = "Delete",
  size = "sm",
  onDeleted,
  disabled,
}: {
  ids: string[];
  label?: string;
  size?: Size;
  onDeleted: (deleted: string[]) => void;
  disabled?: boolean;
}) {
  const n = ids.length;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" size={size} disabled={disabled || n === 0}>
          <Trash2 aria-hidden="true" /> {label}
        </Button>
      }
      title={n === 1 ? "Delete this run?" : `Delete ${n} runs?`}
      description="The saved results and every report saved with them are deleted. This can't be undone."
      confirmLabel="Delete"
      onConfirm={async () => {
        const deleted = await deleteRunsRequest(ids);
        if (deleted.length === 0) throw new Error("Nothing was deleted (runs still in progress can't be deleted).");
        onDeleted(deleted);
      }}
    />
  );
}
