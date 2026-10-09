/**
 * Validation options (the "More options" panel). Client-safe.
 */

export const ENCODINGS = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1256",
  "iso-8859-6",
  "iso-8859-1",
  "windows-1252",
  "iso-8859-2",
  "iso-8859-15",
  "windows-1251",
  "koi8-r",
  "shift_jis",
  "euc-jp",
  "iso-2022-jp",
  "gb18030",
  "gbk",
  "big5",
  "euc-kr",
  "windows-874",
  "windows-1255",
  "iso-8859-8",
] as const;

export type UserAgentPreset = "browser" | "googlebot" | "mobile";

export const USER_AGENTS: Record<UserAgentPreset, { label: string; value: string }> = {
  browser: {
    label: "Desktop browser (Chrome)",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 MarkupLens/0.1",
  },
  googlebot: {
    label: "Googlebot",
    value: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  mobile: {
    label: "Mobile (Android Chrome)",
    value:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 MarkupLens/0.1",
  },
};

export type CssWarningLevel = "none" | "normal" | "more" | "all";

export interface ValidationOptions {
  encoding: {
    /** "auto" = detect; any other value = override with that encoding. */
    override: "auto" | (typeof ENCODINGS)[number];
    /** Apply the override only when the document declares no encoding itself. */
    onlyIfMissing: boolean;
  };
  /** Message list layout: by line, or identical messages grouped together. */
  grouping: "sequential" | "by-type";
  showSource: boolean;
  /** Show the heading outline tab. */
  showOutline: boolean;
  /** Show the image report tab (every <img> with its alt text). */
  imageReport: boolean;
  /** Validate pages that return HTTP 4xx/5xx instead of reporting the status as an error. */
  validateErrorPages: boolean;
  /** Include plain info messages. */
  verbose: boolean;
  userAgent: UserAgentPreset;
  css: {
    warningLevel: CssWarningLevel;
    vendorPrefixes: "warn" | "ignore";
  };
}

export const DEFAULT_OPTIONS: ValidationOptions = {
  encoding: { override: "auto", onlyIfMissing: false },
  grouping: "sequential",
  showSource: true,
  showOutline: true,
  imageReport: true,
  validateErrorPages: false,
  verbose: false,
  userAgent: "browser",
  css: { warningLevel: "normal", vendorPrefixes: "ignore" },
};

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Coerce untrusted input (API body) into a complete, valid options object. */
export function parseOptions(input: unknown): ValidationOptions {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const enc = (o.encoding && typeof o.encoding === "object" ? o.encoding : {}) as Record<string, unknown>;
  const css = (o.css && typeof o.css === "object" ? o.css : {}) as Record<string, unknown>;
  const d = DEFAULT_OPTIONS;
  return {
    encoding: {
      override: pick(enc.override, ["auto", ...ENCODINGS] as const, d.encoding.override),
      onlyIfMissing: flag(enc.onlyIfMissing, d.encoding.onlyIfMissing),
    },
    grouping: pick(o.grouping, ["sequential", "by-type"] as const, d.grouping),
    showSource: flag(o.showSource, d.showSource),
    showOutline: flag(o.showOutline, d.showOutline),
    imageReport: flag(o.imageReport, d.imageReport),
    validateErrorPages: flag(o.validateErrorPages, d.validateErrorPages),
    verbose: flag(o.verbose, d.verbose),
    userAgent: pick(o.userAgent, ["browser", "googlebot", "mobile"] as const, d.userAgent),
    css: {
      warningLevel: pick(css.warningLevel, ["none", "normal", "more", "all"] as const, d.css.warningLevel),
      vendorPrefixes: pick(css.vendorPrefixes, ["warn", "ignore"] as const, d.css.vendorPrefixes),
    },
  };
}
