import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { ImageInfo } from "@/lib/validation/types";
import { lineOf, truncate } from "./dom";

export const LONG_ALT = 150;

/** Alt text that is just a file name, e.g. "IMG_2041.jpg" or "hero-banner.png". */
const FILENAME_ALT = /^[\w\-. ]+\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)$/i;

/** Every <img> with its alt text, flagged: missing / empty (decorative) / file-name / too long. */
export function imageReport($: CheerioAPI): ImageInfo[] {
  const images: ImageInfo[] = [];
  $("img").each((_, node) => {
    const el = node as Element;
    const $el = $(el);
    const alt = $el.attr("alt") ?? null;
    const role = ($el.attr("role") ?? "").toLowerCase();
    const decorative = role === "presentation" || role === "none" || $el.attr("aria-hidden") === "true";
    const src = $el.attr("src") ?? $el.attr("data-src") ?? ($el.attr("srcset") ?? "").split(/[\s,]/)[0] ?? "";

    let status: ImageInfo["status"] = "ok";
    if (alt === null) status = decorative ? "empty" : "missing";
    else if (alt.trim() === "") status = "empty";
    else if (FILENAME_ALT.test(alt.trim())) status = "filename";
    else if (alt.length > LONG_ALT) status = "long";

    images.push({
      src: truncate(src, 300),
      alt,
      width: $el.attr("width"),
      height: $el.attr("height"),
      line: lineOf(el),
      status,
      decorative,
    });
  });
  return images;
}
