"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ImageInfo } from "@/lib/validation/types";

const STATUS: Record<ImageInfo["status"], { label: string; className: string; hint: string }> = {
  missing: { label: "Missing alt", className: "bg-destructive/12 text-destructive", hint: "No alt attribute: screen readers may read the file name instead." },
  empty: { label: "Empty alt", className: "bg-warning/20 text-warning-foreground", hint: "alt=\"\" marks the image as decorative. Check that's intended." },
  filename: { label: "File name", className: "bg-warning/20 text-warning-foreground", hint: "The alt text looks like a file name, not a description." },
  long: { label: "Very long", className: "bg-warning/20 text-warning-foreground", hint: "Over 150 characters; consider a shorter alt plus a caption." },
  ok: { label: "Has alt", className: "bg-success/12 text-success", hint: "" },
};

type Filter = "all" | "problems";

/**
 * Every <img> on the page with its alt text. Images are never loaded or
 * rendered here — only their attributes are shown as text.
 */
export function ImageReport({ images, onJumpToSource }: { images: ImageInfo[]; onJumpToSource?: (line: number) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  if (images.length === 0) return <p className="text-sm text-muted-foreground">No &lt;img&gt; elements found.</p>;

  const counts = images.reduce<Record<ImageInfo["status"], number>>(
    (acc, i) => ({ ...acc, [i.status]: acc[i.status] + 1 }),
    { missing: 0, empty: 0, filename: 0, long: 0, ok: 0 },
  );
  const shown = filter === "all" ? images : images.filter((i) => i.status !== "ok");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-2 text-sm" aria-label="Image summary">
          <li className="rounded-md bg-muted px-2 py-1">{images.length} images</li>
          {(["missing", "empty", "filename", "long", "ok"] as const)
            .filter((s) => counts[s] > 0)
            .map((s) => (
              <li key={s} className={`rounded-md px-2 py-1 font-medium ${STATUS[s].className}`}>
                {counts[s]} {STATUS[s].label.toLowerCase()}
              </li>
            ))}
        </ul>
        <div className="flex gap-1" role="group" aria-label="Show">
          <Button variant="outline" size="sm" aria-pressed={filter === "all"} className={filter === "all" ? "bg-muted" : ""} onClick={() => setFilter("all")}>
            All
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filter === "problems"}
            className={filter === "problems" ? "bg-muted" : ""}
            onClick={() => setFilter("problems")}
          >
            Only flagged
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No flagged images.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Images and their alt text</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Alt text</th>
                <th scope="col" className="px-3 py-2 font-medium">Source</th>
                <th scope="col" className="px-3 py-2 font-medium">Size</th>
                <th scope="col" className="px-3 py-2 font-medium">Line</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.slice(0, 500).map((img, i) => (
                <tr key={`${img.line ?? "x"}-${i}`} className="align-top">
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS[img.status].className}`} title={STATUS[img.status].hint}>
                      {STATUS[img.status].label}
                    </span>
                    {img.decorative && <span className="mt-1 block text-[11px] text-muted-foreground">role/aria marks it decorative</span>}
                  </td>
                  <td className="max-w-64 px-3 py-2 break-words">
                    {img.alt === null ? <span className="text-muted-foreground italic">no alt attribute</span> : img.alt === "" ? <code className="text-xs">alt=&quot;&quot;</code> : img.alt}
                  </td>
                  <td className="max-w-72 px-3 py-2 font-mono text-xs break-all text-muted-foreground">{img.src || "—"}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap tabular-nums">{img.width || img.height ? `${img.width ?? "?"} × ${img.height ?? "?"}` : "—"}</td>
                  <td className="px-3 py-2">
                    {img.line !== undefined && onJumpToSource ? (
                      <Button variant="ghost" size="xs" className="tabular-nums" onClick={() => onJumpToSource(img.line!)} aria-label={`Jump to line ${img.line}`}>
                        L{img.line}
                      </Button>
                    ) : (
                      <span className="tabular-nums">{img.line ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 500 && <p className="border-t p-2 text-xs text-muted-foreground">Showing the first 500 of {shown.length} images.</p>}
        </div>
      )}
    </div>
  );
}
