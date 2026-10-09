/**
 * Right-to-left script detection (Arabic, Hebrew, Urdu, Persian, Syriac,
 * Thaana, N'Ko …) for the lang/dir checks.
 */

/** Strong RTL letters: Hebrew, Arabic (+ supplements/presentation forms), Syriac, Thaana, N'Ko, Samaritan, Mandaic. */
const RTL_LETTER =
  /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿߀-߿ࠀ-࠿ࡀ-࡟ࡠ-࡯ࡰ-࢟ࢠ-ࣿיִ-ﭏﭐ-﷿ﹰ-﻿]/gu;
/** Any letter (for the ratio). */
const ANY_LETTER = /\p{L}/gu;

/** Languages written right-to-left (primary subtags). */
export const RTL_LANGUAGES = new Set([
  "ar",
  "arc",
  "ckb",
  "dv",
  "fa",
  "ha-arab",
  "he",
  "iw",
  "khw",
  "ks",
  "ku-arab",
  "mzn",
  "nqo",
  "pnb",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
]);

export interface ScriptStats {
  rtlLetters: number;
  letters: number;
  /** Share of letters that are RTL (0–1). */
  ratio: number;
}

export function scriptStats(text: string): ScriptStats {
  const rtlLetters = text.match(RTL_LETTER)?.length ?? 0;
  const letters = text.match(ANY_LETTER)?.length ?? 0;
  return { rtlLetters, letters, ratio: letters === 0 ? 0 : rtlLetters / letters };
}

/** True when a BCP 47 tag is for an RTL language (or uses the Arabic/Hebrew script subtag). */
export function isRtlLanguage(tag: string | undefined): boolean {
  if (!tag) return false;
  const lower = tag.trim().toLowerCase();
  const primary = lower.split("-")[0];
  if (/-(arab|hebr|syrc|thaa|nkoo|adlm|rohg)(-|$)/.test(lower)) return true;
  if (/-(latn|cyrl)(-|$)/.test(lower)) return false;
  return RTL_LANGUAGES.has(primary) || RTL_LANGUAGES.has(lower);
}

/** Validate a BCP 47 language tag. */
export function isValidLanguageTag(tag: string): boolean {
  if (!/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(tag.trim())) return false;
  try {
    return Intl.getCanonicalLocales(tag.trim()).length === 1;
  } catch {
    return false;
  }
}

/** Thresholds used by the RTL check. */
export const RTL_PREDOMINANT = 0.5;
export const RTL_MIN_LETTERS = 20;
