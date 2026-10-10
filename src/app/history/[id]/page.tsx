import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { HistoryUnavailable } from "@/components/history/history-unavailable";
import { SavedRunView } from "@/components/history/saved-run-view";
import { loadRun, previousRunId } from "@/lib/history/store";
import type { SavedRun } from "@/lib/history/types";

export const metadata: Metadata = { title: "Saved run" };

async function SavedRunLoader({ params }: { params: PageProps<"/history/[id]">["params"] }) {
  const { id } = await params;
  let saved: SavedRun | undefined;
  let previous: string | undefined;
  try {
    saved = await loadRun(id);
    if (saved) previous = await previousRunId(saved.summary);
  } catch (err) {
    console.error("Loading the saved run failed:", err);
    return <HistoryUnavailable />;
  }
  if (!saved) notFound();
  return <SavedRunView key={saved.summary.id} saved={saved} previousId={previous} />;
}

export default function SavedRunPage({ params }: PageProps<"/history/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:py-10">
      <Suspense
        fallback={
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the saved run…
          </p>
        }
      >
        <SavedRunLoader params={params} />
      </Suspense>
    </div>
  );
}
