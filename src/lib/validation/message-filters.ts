import type { ValidationMessage } from "./types";

/**
 * User-defined message filters ("hide messages like this"), mirroring the
 * Nu checker's message filtering. Stored in localStorage by the UI.
 */
export interface MessageFilter {
  id: string;
  pattern: string;
  /** Treat pattern as a regular expression (case-insensitive); otherwise a case-insensitive substring. */
  isRegex: boolean;
}

export function parseFilters(raw: unknown): MessageFilter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is MessageFilter =>
        !!f && typeof f === "object" && typeof f.id === "string" && typeof f.pattern === "string" && typeof f.isRegex === "boolean",
    )
    .slice(0, 200);
}

/** Returns an error message if the pattern is not a valid regular expression. */
export function regexError(pattern: string): string | undefined {
  try {
    new RegExp(pattern, "i");
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid regular expression";
  }
}

export function compileFilters(filters: MessageFilter[]): (message: ValidationMessage) => boolean {
  const tests = filters
    .map((f) => {
      if (f.isRegex) {
        if (regexError(f.pattern)) return null;
        const re = new RegExp(f.pattern, "i");
        return (text: string) => re.test(text);
      }
      const needle = f.pattern.toLowerCase();
      return needle ? (text: string) => text.toLowerCase().includes(needle) : null;
    })
    .filter((t): t is (text: string) => boolean => t !== null);
  return (message) => tests.some((t) => t(message.message));
}

/** Escape a message so it can be used as an exact-match regex filter. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
