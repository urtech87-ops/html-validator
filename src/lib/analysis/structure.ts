import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { CheckStatus, ImageInfo, OutlineHeading, StructureCheck, StructureReport } from "@/lib/validation/types";
import { accessibleName, capLocations, collapse, describe, lineOf, locate, visibleText } from "./dom";
import { imageReport } from "./images";
import { buildOutline } from "./outline";
import { isRtlLanguage, isValidLanguageTag, RTL_MIN_LETTERS, RTL_PREDOMINANT, scriptStats } from "./rtl";

/**
 * Structure & best-practice analysis, run on the parsed DOM independently of
 * vnu. Every check is pass / warning / fail with a one-line explanation.
 */

export interface StructureContext {
  /** Direct-input fragment: skip document-level checks (title, meta, lang, landmarks, RTL). */
  fragment?: boolean;
  /** Charset declared in the HTTP Content-Type header, if any. */
  httpCharset?: string;
}

export const DEPRECATED_ELEMENTS = [
  "acronym",
  "applet",
  "basefont",
  "bgsound",
  "big",
  "blink",
  "center",
  "dir",
  "font",
  "frame",
  "frameset",
  "isindex",
  "keygen",
  "listing",
  "marquee",
  "menuitem",
  "nobr",
  "noembed",
  "noframes",
  "plaintext",
  "rb",
  "rtc",
  "spacer",
  "strike",
  "tt",
  "xmp",
];

export const TITLE_MIN = 10;
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 160;

const check = (
  id: string,
  title: string,
  status: CheckStatus,
  explanation: string,
  extra: Partial<Pick<StructureCheck, "details" | "locations" | "affected">> = {},
): StructureCheck => ({ id, title, status, explanation, ...extra });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function analyzeStructure(html: string, context: StructureContext = {}): StructureReport {
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
  const outline = buildOutline($);
  const images = imageReport($);
  const checks: StructureCheck[] = [];

  checks.push(...headingChecks(outline, !!context.fragment));
  if (!context.fragment) {
    checks.push(landmarkCheck($));
    checks.push(langCheck($));
    checks.push(rtlCheck($));
    checks.push(titleCheck($));
    checks.push(descriptionCheck($));
    checks.push(viewportCheck($));
    checks.push(charsetCheck($, context.httpCharset));
  }
  checks.push(imagesCheck(images));
  checks.push(emptyLinksCheck($));
  checks.push(buttonNamesCheck($));
  checks.push(duplicateIdsCheck($));
  checks.push(inlineStylesCheck($));
  checks.push(deprecatedCheck($));
  checks.push(formLabelsCheck($));

  const counts = { pass: 0, warning: 0, fail: 0 };
  for (const c of checks) counts[c.status]++;
  return { scope: context.fragment ? "fragment" : "document", checks, outline, images, counts };
}

/* ---------------------------------------------------------------- headings */

function headingChecks(outline: OutlineHeading[], fragment: boolean): StructureCheck[] {
  const h1s = outline.filter((h) => h.level === 1);
  const loc = (h: OutlineHeading) => (h.line ? { line: h.line, label: `<h${h.level}> ${h.text || "(empty)"}` } : undefined);
  const out: StructureCheck[] = [];

  if (!fragment) {
    if (h1s.length === 1) out.push(check("h1", "Single <h1>", "pass", "The page has exactly one top-level heading.", { locations: capLocations(h1s.map(loc)).locations }));
    else if (h1s.length === 0) out.push(check("h1", "Single <h1>", "fail", "The page has no <h1>. Give every page one main heading that describes it."));
    else
      out.push(
        check("h1", "Single <h1>", "warning", `The page has ${h1s.length} <h1> elements. Use one main heading and h2–h6 below it.`, {
          ...capLocations(h1s.map(loc)),
        }),
      );
  }

  const skipped = outline.filter((h) => h.issues.includes("skipped-level"));
  const empty = outline.filter((h) => h.issues.includes("empty"));
  if (outline.length === 0) {
    out.push(check("heading-order", "Heading order", fragment ? "pass" : "warning", fragment ? "No headings in this fragment." : "The page has no headings at all."));
  } else if (skipped.length === 0 && empty.length === 0) {
    out.push(check("heading-order", "Heading order", "pass", `${plural(outline.length, "heading")}, no skipped levels.`));
  } else {
    const details = [
      ...skipped.map((h) => `h${h.previousLevel || "(start)"} → h${h.level}: “${h.text || "(empty)"}”${h.line ? ` (line ${h.line})` : ""}`),
      ...empty.map((h) => `Empty <h${h.level}>${h.line ? ` on line ${h.line}` : ""}`),
    ];
    out.push(
      check(
        "heading-order",
        "Heading order",
        "warning",
        [skipped.length && `${plural(skipped.length, "heading")} skip a level`, empty.length && `${plural(empty.length, "heading")} empty`].filter(Boolean).join("; ") +
          ". Screen-reader users navigate by heading level.",
        { details, ...capLocations([...skipped, ...empty].map(loc)) },
      ),
    );
  }
  return out;
}

/* --------------------------------------------------------------- landmarks */

const LANDMARKS: Array<{ tag: string; role: string }> = [
  { tag: "header", role: "banner" },
  { tag: "nav", role: "navigation" },
  { tag: "main", role: "main" },
  { tag: "footer", role: "contentinfo" },
];

function landmarkCheck($: CheerioAPI): StructureCheck {
  const present = LANDMARKS.filter(({ tag, role }) => $(`${tag}, [role="${role}"]`).length > 0).map((l) => l.tag);
  const missing = LANDMARKS.map((l) => l.tag).filter((t) => !present.includes(t));
  const details = [`Present: ${present.length ? present.map((t) => `<${t}>`).join(", ") : "none"}`, `Missing: ${missing.length ? missing.map((t) => `<${t}>`).join(", ") : "none"}`];
  if (!present.includes("main")) {
    return check("landmarks", "Landmarks", "fail", "No <main> landmark. Wrap the page's primary content in <main> so assistive technology can jump to it.", { details });
  }
  if (missing.length) {
    return check("landmarks", "Landmarks", "warning", `<main> is present, but ${missing.map((t) => `<${t}>`).join(", ")} ${missing.length === 1 ? "is" : "are"} missing.`, { details });
  }
  return check("landmarks", "Landmarks", "pass", "<header>, <nav>, <main> and <footer> are all present.", { details });
}

/* ------------------------------------------------------------ lang and dir */

function langCheck($: CheerioAPI): StructureCheck {
  const html = $("html").get(0) as Element | undefined;
  const lang = $("html").attr("lang") ?? $("html").attr("xml:lang");
  const where = html ? capLocations([locate($, html)]).locations : undefined;
  if (lang === undefined) return check("html-lang", "Page language (<html lang>)", "fail", "<html> has no lang attribute. Screen readers need it to pick the right voice.", { locations: where });
  if (!lang.trim()) return check("html-lang", "Page language (<html lang>)", "fail", "<html lang> is empty.", { locations: where });
  if (!isValidLanguageTag(lang)) return check("html-lang", "Page language (<html lang>)", "fail", `“${lang}” is not a valid BCP 47 language tag (e.g. en, en-GB, ar, ar-EG).`, { locations: where });
  const dir = $("html").attr("dir");
  if (dir !== undefined && !["ltr", "rtl", "auto"].includes(dir.trim().toLowerCase())) {
    return check("html-lang", "Page language (<html lang>)", "warning", `lang="${lang}" is valid, but dir="${dir}" is not one of ltr, rtl or auto.`, { locations: where });
  }
  return check("html-lang", "Page language (<html lang>)", "pass", `lang="${lang}"${dir ? `, dir="${dir}"` : ""}.`, { locations: where });
}

function rtlCheck($: CheerioAPI): StructureCheck {
  const body = $("body").get(0) ?? $.root().get(0)!;
  const stats = scriptStats(visibleText($, body) + " " + collapse($("title").text()));
  const lang = $("html").attr("lang");
  const dir = ($("html").attr("dir") ?? $("body").attr("dir") ?? "").trim().toLowerCase();
  const rtlDir = dir === "rtl";
  const rtlLang = isRtlLanguage(lang);
  const pct = Math.round(stats.ratio * 100);
  const facts = [`Right-to-left letters: ${stats.rtlLetters} of ${stats.letters} (${pct}%)`, `<html lang>: ${lang ?? "missing"}`, `dir: ${dir || "missing"}`];
  const htmlEl = $("html").get(0) as Element | undefined;
  const where = htmlEl ? capLocations([locate($, htmlEl)]).locations : undefined;

  if (stats.rtlLetters >= RTL_MIN_LETTERS && stats.ratio >= RTL_PREDOMINANT) {
    const problems = [!rtlDir && `dir is ${dir ? `“${dir}”` : "missing"} (should be “rtl”)`, !rtlLang && `lang is ${lang ? `“${lang}”` : "missing"} (should be an RTL language such as ar, he, ur or fa)`].filter(Boolean);
    if (problems.length === 0) return check("rtl", "Right-to-left content", "pass", `Mostly right-to-left text (${pct}%), with dir="rtl" and lang="${lang}".`, { details: facts });
    return check("rtl", "Right-to-left content", rtlDir ? "warning" : "fail", `The page is mostly Arabic/Hebrew/Urdu-script text (${pct}%), but ${problems.join(" and ")}.`, {
      details: facts,
      locations: where,
    });
  }

  if (stats.rtlLetters >= RTL_MIN_LETTERS) {
    // Mixed content: RTL passages should be marked up individually.
    const marked = $('[dir="rtl"], [dir="auto"], bdi').length > 0 || $("[lang]").toArray().some((el) => isRtlLanguage($(el).attr("lang")));
    if (rtlDir || marked) return check("rtl", "Right-to-left content", "pass", `Mixed content with ${pct}% right-to-left text; RTL passages are marked with dir/lang.`, { details: facts });
    return check("rtl", "Right-to-left content", "warning", `${stats.rtlLetters} Arabic/Hebrew-script letters (${pct}%) but no element marks them with dir="rtl", dir="auto" or an RTL lang.`, {
      details: facts,
    });
  }

  if (rtlDir) {
    return check("rtl", "Right-to-left content", "warning", `dir="rtl" is set but the page has ${stats.rtlLetters ? "almost " : ""}no right-to-left text. Check the direction is intended.`, {
      details: facts,
      locations: where,
    });
  }
  return check("rtl", "Right-to-left content", "pass", "No right-to-left text, and the page is not marked rtl.", { details: facts });
}

/* -------------------------------------------------------------------- head */

function titleCheck($: CheerioAPI): StructureCheck {
  const el = $("head title").first().get(0) ?? $("title").first().get(0);
  if (!el) return check("title", "<title>", "fail", "The page has no <title>. Browsers, search engines and screen readers all use it.");
  const text = collapse($(el).text());
  const where = capLocations([locate($, el as Element)]).locations;
  if (!text) return check("title", "<title>", "fail", "<title> is empty.", { locations: where });
  const n = text.length;
  if (n < TITLE_MIN) return check("title", "<title>", "warning", `“${text}” is only ${n} characters. Aim for ${TITLE_MIN}–${TITLE_MAX}.`, { locations: where });
  if (n > TITLE_MAX) return check("title", "<title>", "warning", `The title is ${n} characters; search results usually cut it after about ${TITLE_MAX}.`, { details: [text], locations: where });
  return check("title", "<title>", "pass", `“${text}” (${n} characters).`, { locations: where });
}

function descriptionCheck($: CheerioAPI): StructureCheck {
  const el = $('meta[name="description" i]').first().get(0) as Element | undefined;
  if (!el) return check("meta-description", "Meta description", "warning", 'No <meta name="description">. Search engines show it under the title.');
  const text = collapse($(el).attr("content") ?? "");
  const where = capLocations([locate($, el)]).locations;
  if (!text) return check("meta-description", "Meta description", "warning", "The meta description is empty.", { locations: where });
  const n = text.length;
  if (n < DESCRIPTION_MIN || n > DESCRIPTION_MAX) {
    return check("meta-description", "Meta description", "warning", `The description is ${n} characters; ${DESCRIPTION_MIN}–${DESCRIPTION_MAX} works best.`, { details: [text], locations: where });
  }
  return check("meta-description", "Meta description", "pass", `${n} characters.`, { details: [text], locations: where });
}

function viewportCheck($: CheerioAPI): StructureCheck {
  const el = $('meta[name="viewport" i]').first().get(0) as Element | undefined;
  if (!el) return check("viewport", "Viewport meta", "warning", 'No <meta name="viewport">. Without it, phones render the page at desktop width.');
  const content = ($(el).attr("content") ?? "").toLowerCase().replace(/\s+/g, "");
  const where = capLocations([locate($, el)]).locations;
  const maxScale = /maximum-scale=([\d.]+)/.exec(content);
  if (/user-scalable=(no|0)/.test(content) || (maxScale && Number(maxScale[1]) < 2)) {
    return check("viewport", "Viewport meta", "warning", "The viewport blocks or limits zooming (user-scalable=no / maximum-scale < 2), which fails WCAG 1.4.4.", { details: [content], locations: where });
  }
  if (!content.includes("width=device-width")) {
    return check("viewport", "Viewport meta", "warning", "The viewport is present but doesn't set width=device-width.", { details: [content], locations: where });
  }
  return check("viewport", "Viewport meta", "pass", content, { locations: where });
}

function charsetCheck($: CheerioAPI, httpCharset: string | undefined): StructureCheck {
  const el = ($("meta[charset]").first().get(0) ?? $('meta[http-equiv="content-type" i]').first().get(0)) as Element | undefined;
  if (el) {
    const value = $(el).attr("charset") ?? /charset=([\w-]+)/i.exec($(el).attr("content") ?? "")?.[1] ?? "?";
    const where = capLocations([locate($, el)]).locations;
    const offset = el.sourceCodeLocation?.startOffset ?? 0;
    if (offset > 1024) return check("charset", "Character encoding declaration", "warning", `<meta charset="${value}"> appears after the first 1024 bytes, so browsers may ignore it. Put it first in <head>.`, { locations: where });
    if (value.toLowerCase() !== "utf-8") return check("charset", "Character encoding declaration", "warning", `The page declares “${value}”. UTF-8 is recommended for all new content.`, { locations: where });
    return check("charset", "Character encoding declaration", "pass", `<meta charset="${value}"> is declared early in <head>.`, { locations: where });
  }
  if (httpCharset) return check("charset", "Character encoding declaration", "pass", `No <meta charset>, but the server sends charset=${httpCharset}. Adding <meta charset="utf-8"> keeps saved copies readable.`);
  return check("charset", "Character encoding declaration", "fail", 'No <meta charset> and no charset in the HTTP header. Add <meta charset="utf-8"> as the first element in <head>.');
}

/* ------------------------------------------------------------ accessibility */

function imagesCheck(images: ImageInfo[]): StructureCheck {
  const missing = images.filter((i) => i.status === "missing");
  const suspicious = images.filter((i) => i.status === "filename" || i.status === "long");
  const loc = (i: ImageInfo) => (i.line ? { line: i.line, label: `<img src="${i.src.slice(0, 60)}">` } : undefined);
  if (images.length === 0) return check("img-alt", "Images have alt text", "pass", "The page has no <img> elements.");
  if (missing.length) {
    return check("img-alt", "Images have alt text", "fail", `${plural(missing.length, "image")} of ${images.length} ${missing.length === 1 ? "has" : "have"} no alt attribute. Use alt="" for decorative images.`, capLocations(missing.map(loc)));
  }
  if (suspicious.length) {
    return check("img-alt", "Images have alt text", "warning", `All images have alt, but ${plural(suspicious.length, "alt text")} ${suspicious.length === 1 ? "looks" : "look"} like a file name or ${suspicious.length === 1 ? "is" : "are"} very long.`, capLocations(suspicious.map(loc)));
  }
  return check("img-alt", "Images have alt text", "pass", `All ${plural(images.length, "image")} have an alt attribute.`);
}

function emptyLinksCheck($: CheerioAPI): StructureCheck {
  const bad = $("a[href]")
    .toArray()
    .filter((el) => !accessibleName($, el as Element));
  if (bad.length === 0) return check("link-text", "Links have text", "pass", `All ${$("a[href]").length} links have an accessible name.`);
  return check("link-text", "Links have text", "fail", `${plural(bad.length, "link")} with no text, aria-label or image alt. Screen readers announce them as just “link”.`, capLocations(bad.map((el) => locate($, el as Element))));
}

function buttonNamesCheck($: CheerioAPI): StructureCheck {
  const buttons = $('button, [role="button"], input[type="button" i], input[type="submit" i], input[type="reset" i], input[type="image" i]').toArray() as Element[];
  const bad = buttons.filter((el) => {
    if (el.tagName === "input") {
      const type = ($(el).attr("type") ?? "").toLowerCase();
      if (type === "image") return !collapse($(el).attr("alt") ?? $(el).attr("aria-label") ?? "");
      // submit/reset have a default label; button needs value
      if (type === "submit" || type === "reset") return false;
      return !collapse($(el).attr("value") ?? $(el).attr("aria-label") ?? "");
    }
    return !accessibleName($, el);
  });
  if (buttons.length === 0) return check("button-name", "Buttons have names", "pass", "No buttons on the page.");
  if (bad.length === 0) return check("button-name", "Buttons have names", "pass", `All ${plural(buttons.length, "button")} have an accessible name.`);
  return check("button-name", "Buttons have names", "fail", `${plural(bad.length, "button")} with no text or aria-label (icon-only buttons need aria-label).`, capLocations(bad.map((el) => locate($, el))));
}

function duplicateIdsCheck($: CheerioAPI): StructureCheck {
  const byId = new Map<string, Element[]>();
  $("[id]").each((_, node) => {
    const id = $(node).attr("id")!;
    byId.set(id, [...(byId.get(id) ?? []), node as Element]);
  });
  const dupes = [...byId].filter(([, els]) => els.length > 1);
  if (dupes.length === 0) return check("duplicate-ids", "Unique IDs", "pass", `${plural(byId.size, "id")}, all unique.`);
  return check("duplicate-ids", "Unique IDs", "fail", `${plural(dupes.length, "id")} used more than once. Labels, anchors and ARIA references break.`, {
    details: dupes.slice(0, 50).map(([id, els]) => `“${id}” ×${els.length} (lines ${els.map(lineOf).filter(Boolean).join(", ")})`),
    ...capLocations(dupes.flatMap(([, els]) => els.map((el) => locate($, el)))),
  });
}

function inlineStylesCheck($: CheerioAPI): StructureCheck {
  const styled = $("[style]").toArray() as Element[];
  if (styled.length === 0) return check("inline-styles", "Inline style attributes", "pass", "No elements use the style attribute.");
  return check("inline-styles", "Inline style attributes", "warning", `${plural(styled.length, "element")} use${styled.length === 1 ? "s" : ""} a style attribute. Move styling into CSS classes so it can be reused and overridden.`, capLocations(styled.map((el) => locate($, el))));
}

function deprecatedCheck($: CheerioAPI): StructureCheck {
  const found = $(DEPRECATED_ELEMENTS.join(", ")).toArray() as Element[];
  if (found.length === 0) return check("deprecated", "Deprecated elements", "pass", "No obsolete elements such as <center>, <font> or <marquee>.");
  const counts = new Map<string, number>();
  for (const el of found) counts.set(el.tagName, (counts.get(el.tagName) ?? 0) + 1);
  return check("deprecated", "Deprecated elements", "fail", `${plural(found.length, "obsolete element")}: ${[...counts].map(([t, n]) => `<${t}> ×${n}`).join(", ")}. Replace them with CSS or modern elements.`, capLocations(found.map((el) => locate($, el))));
}

function formLabelsCheck($: CheerioAPI): StructureCheck {
  const fields = $("input, select, textarea")
    .toArray()
    .filter((el) => {
      const type = ($(el).attr("type") ?? "text").toLowerCase();
      return !["hidden", "submit", "reset", "button", "image"].includes(type);
    }) as Element[];
  // Lookups built once: ids that have a non-empty <label for>, and all ids in the document.
  const labelledIds = new Set(
    $("label[for]")
      .toArray()
      .filter((l) => collapse(visibleText($, l)))
      .map((l) => $(l).attr("for")!),
  );
  const allIds = new Set($("[id]").toArray().map((el) => $(el).attr("id")!));
  const labelled = (el: Element) => {
    const id = $(el).attr("id");
    if (id && labelledIds.has(id)) return true;
    const wrapper = $(el).closest("label").get(0);
    if (wrapper && collapse(visibleText($, wrapper))) return true;
    if (collapse($(el).attr("aria-label") ?? "")) return true;
    const labelledBy = $(el).attr("aria-labelledby");
    if (labelledBy && labelledBy.split(/\s+/).some((ref) => allIds.has(ref))) return true;
    return !!collapse($(el).attr("title") ?? "");
  };
  const bad = fields.filter((el) => !labelled(el));
  if (fields.length === 0) return check("form-labels", "Form fields have labels", "pass", "No form fields on the page.");
  if (bad.length === 0) return check("form-labels", "Form fields have labels", "pass", `All ${plural(fields.length, "form field")} have a label.`);
  const placeholderOnly = bad.filter((el) => collapse($(el).attr("placeholder") ?? "")).length;
  return check(
    "form-labels",
    "Form fields have labels",
    "fail",
    `${plural(bad.length, "form field")} without an associated <label>, aria-label or aria-labelledby${placeholderOnly ? ` (${placeholderOnly} rely on placeholder only, which is not a label)` : ""}.`,
    capLocations(bad.map((el) => ({ line: lineOf(el) ?? 0, label: describe($, el) })).map((l) => (l.line ? l : undefined))),
  );
}
