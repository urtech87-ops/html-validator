import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { OutlineHeading } from "@/lib/validation/types";
import { accessibleName, lineOf } from "./dom";

/**
 * Heading outline (h1–h6 in document order), flagging skipped levels
 * (e.g. h1 → h3), empty headings and every h1 after the first.
 */
export function buildOutline($: CheerioAPI): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let previous = 0;
  let h1Count = 0;

  $("h1, h2, h3, h4, h5, h6").each((_, node) => {
    const el = node as Element;
    const level = Number(el.tagName.slice(1));
    const text = accessibleName($, el);
    const issues: OutlineHeading["issues"] = [];

    if (level === 1 && ++h1Count > 1) issues.push("extra-h1");
    // Going deeper by more than one level is a skip; going back up any amount is fine.
    // The first heading may be anything, but starting below h2 is also treated as a skip.
    const skipped = previous === 0 ? level > 2 : level > previous + 1;
    if (skipped) issues.push("skipped-level");
    if (!text) issues.push("empty");

    headings.push({
      level,
      text,
      line: lineOf(el),
      issues,
      previousLevel: skipped ? previous : undefined,
    });
    previous = level;
  });

  return headings;
}
