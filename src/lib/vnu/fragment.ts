import type { ValidationMessage } from "@/lib/validation/types";

/**
 * Fragment support for direct input: the user's markup is wrapped in a
 * minimal HTML5 skeleton before validation, then message line numbers are
 * shifted back so they match the user's own input.
 *
 * The prefix ends with a newline, so the user's first line starts at column 1
 * of line FRAGMENT_PREFIX_LINES + 1 and columns never need adjusting.
 */
export const FRAGMENT_PREFIX = [
  "<!DOCTYPE html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  "<title>Fragment</title>",
  "</head>",
  "<body>",
  "",
].join("\n");

export const FRAGMENT_SUFFIX = "\n</body>\n</html>\n";

/** Number of lines the prefix adds before the user's first line. */
export const FRAGMENT_PREFIX_LINES = FRAGMENT_PREFIX.split("\n").length - 1;

export function wrapFragment(fragment: string): string {
  return FRAGMENT_PREFIX + fragment + FRAGMENT_SUFFIX;
}

/**
 * Map a message from the wrapped document back onto the fragment.
 * - Lines inside the user's input are shifted by the prefix length.
 * - Messages pointing into the prefix are clamped to line 1.
 * - Messages pointing into the suffix (e.g. "unclosed element" reported at
 *   </body>) are clamped to the fragment's last line.
 */
export function mapFragmentMessage(message: ValidationMessage, fragmentLineCount: number): ValidationMessage {
  if (message.lastLine === undefined && message.firstLine === undefined) return message;

  const mapLine = (line: number | undefined): { line?: number; clamped: boolean } => {
    if (line === undefined) return { line, clamped: false };
    const mapped = line - FRAGMENT_PREFIX_LINES;
    if (mapped < 1) return { line: 1, clamped: true };
    if (mapped > fragmentLineCount) return { line: fragmentLineCount, clamped: true };
    return { line: mapped, clamped: false };
  };

  const first = mapLine(message.firstLine);
  const last = mapLine(message.lastLine);
  return {
    ...message,
    firstLine: first.line,
    lastLine: last.line,
    // A clamped position no longer points at a real column of the input.
    firstColumn: first.clamped ? undefined : message.firstColumn,
    lastColumn: last.clamped ? undefined : message.lastColumn,
  };
}

export function lineCount(text: string): number {
  if (text.length === 0) return 1;
  return text.split(/\r\n|\r|\n/).length;
}
