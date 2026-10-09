import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { SourceLocation } from "@/lib/validation/types";

/** Shared DOM helpers for the structure analysis (cheerio, parsed with source locations). */

export function lineOf(el: Element): number | undefined {
  return el.sourceCodeLocation?.startLine;
}

export function columnOf(el: Element): number | undefined {
  return el.sourceCodeLocation?.startCol;
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A short, safe label for an element: its start tag with a few key attributes. */
export function describe($: CheerioAPI, el: Element): string {
  const keep = ["id", "name", "type", "src", "href", "for", "class", "role"];
  const attrs = keep
    .map((a) => [a, $(el).attr(a)] as const)
    .filter(([, v]) => v !== undefined)
    .slice(0, 3)
    .map(([a, v]) => `${a}="${truncate(v!, 40)}"`);
  return `<${el.tagName}${attrs.length ? " " + attrs.join(" ") : ""}>`;
}

export function locate($: CheerioAPI, el: Element): SourceLocation | undefined {
  const line = lineOf(el);
  return line === undefined ? undefined : { line, column: columnOf(el), label: describe($, el) };
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Text of an element as a screen reader would roughly read it: text nodes plus img alt. */
export function visibleText($: CheerioAPI, el: AnyNode): string {
  let out = "";
  $(el)
    .contents()
    .each((_, node) => {
      if (node.type === "text") out += (node as unknown as { data: string }).data;
      else if (node.type === "tag") {
        const child = node as Element;
        if (child.tagName === "img") out += ` ${$(child).attr("alt") ?? ""} `;
        else if (!["script", "style", "template"].includes(child.tagName) && $(child).attr("aria-hidden") !== "true") {
          out += visibleText($, child);
        }
      }
    });
  return out;
}

/**
 * Approximate accessible name: aria-labelledby → aria-label → content
 * (text + img alt) → title. Good enough to flag elements with *no* name.
 */
export function accessibleName($: CheerioAPI, el: Element): string {
  const labelledBy = $(el).attr("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => {
        const target = $(`[id="${cssEscape(id)}"]`).get(0);
        return target ? collapse(visibleText($, target)) : "";
      })
      .join(" ");
    if (collapse(text)) return collapse(text);
  }
  const ariaLabel = collapse($(el).attr("aria-label") ?? "");
  if (ariaLabel) return ariaLabel;
  const content = collapse(visibleText($, el));
  if (content) return content;
  // <svg><title> inside links/buttons
  const svgTitle = collapse($(el).find("svg title").first().text());
  if (svgTitle) return svgTitle;
  return collapse($(el).attr("title") ?? "");
}

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/** Cap a list of locations, keeping the total. */
export function capLocations(list: Array<SourceLocation | undefined>, max = 25): { locations: SourceLocation[]; affected: number } {
  const all = list.filter((l): l is SourceLocation => l !== undefined);
  return { locations: all.slice(0, max), affected: list.length };
}
