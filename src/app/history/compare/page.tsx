import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, Loader2 } from "lucide-react";
import { CompareView } from "@/components/history/compare-view";
import { HistoryUnavailable } from "@/components/history/history-unavailable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CompareError, loadComparison } from "@/lib/history/comparison";
import type { CompareResult } from "@/lib/history/compare-types";

export const metadata: Metadata = { title: "Compare runs" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{children}</p>
        <p>
          <Link href="/history" className="underline underline-offset-4">
            Back to history
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}

async function Comparison({ searchParams }: { searchParams: PageProps<"/history/compare">["searchParams"] }) {
  const params = await searchParams;
  let result: CompareResult | undefined;
  try {
    result = await loadComparison(first(params.a), first(params.b));
  } catch (err) {
    if (err instanceof CompareError) return <Problem title="These runs can't be compared">{err.message}</Problem>;
    console.error("Comparing runs failed:", err);
    return <HistoryUnavailable />;
  }
  if (!result) return <Problem title="Run not found">One of the runs no longer exists (it may have been deleted).</Problem>;
  return <CompareView result={result} />;
}

export default function ComparePage({ searchParams }: PageProps<"/history/compare">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:py-10">
      <Suspense
        fallback={
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Comparing…
          </p>
        }
      >
        <Comparison searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
