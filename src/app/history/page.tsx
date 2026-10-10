import { Suspense } from "react";
import type { Metadata } from "next";
import { Loader2 } from "lucide-react";
import { HistoryBrowser } from "@/components/history/history-browser";
import { HistoryUnavailable } from "@/components/history/history-unavailable";
import { listRuns } from "@/lib/history/store";
import { parseHistoryQuery } from "@/lib/history/types";

export const metadata: Metadata = {
  title: "History",
  description: "Every validation run, saved: search, re-run, compare and download saved reports.",
};

async function HistoryList({ searchParams }: { searchParams: PageProps<"/history">["searchParams"] }) {
  const query = parseHistoryQuery(await searchParams);
  let page;
  try {
    page = await listRuns(query);
  } catch (err) {
    console.error("Loading history failed:", err);
  }
  if (!page) return <HistoryUnavailable />;
  return <HistoryBrowser key={JSON.stringify(query)} page={page} query={{ ...query, page: page.page }} />;
}

export default function HistoryPage({ searchParams }: PageProps<"/history">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:py-10">
      <section className="max-w-2xl space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">History</h1>
        <p className="text-muted-foreground text-pretty">
          Every run is saved here with its options and results. Open one to see its results and saved reports, run it again, or select two
          runs of the same page or site to see what changed.
        </p>
      </section>
      <Suspense
        fallback={
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading history…
          </p>
        }
      >
        <HistoryList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
