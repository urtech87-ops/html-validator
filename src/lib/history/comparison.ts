import "server-only";
import { slugify } from "@/lib/report/filename";
import { compareRuns, CompareError } from "./compare";
import type { CompareResult } from "./compare-types";
import { loadRun } from "./store";

/** Load two saved runs and compare them. Throws CompareError (bad pair) or returns undefined (a run is missing). */
export async function loadComparison(a: string, b: string): Promise<CompareResult | undefined> {
  if (!a || !b) throw new CompareError("Pick two runs to compare (?a=<run id>&b=<run id>).");
  const [x, y] = await Promise.all([loadRun(a), loadRun(b)]);
  if (!x || !y) return undefined;
  return compareRuns(x, y);
}

export function comparisonFilename(result: CompareResult, extension: "json" | "xlsx", date = new Date().toISOString().slice(0, 10)): string {
  return `markuplens-compare-${slugify(result.after.target) || "runs"}-${date}.${extension}`;
}

export { CompareError };
