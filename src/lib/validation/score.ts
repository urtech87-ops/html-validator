import type { MessageCounts, ValidationMessage } from "./types";

/**
 * Quality score (0–100):
 *   score = max(0, 100 − 5 × errors − 1 × warnings)
 * Info messages do not affect the score.
 */
export function computeScore(counts: MessageCounts): number {
  return Math.max(0, 100 - 5 * counts.errors - counts.warnings);
}

export function countMessages(messages: ValidationMessage[]): MessageCounts {
  const counts: MessageCounts = { errors: 0, warnings: 0, info: 0 };
  for (const m of messages) {
    if (m.severity === "error") counts.errors++;
    else if (m.severity === "warning") counts.warnings++;
    else counts.info++;
  }
  return counts;
}

export function sumCounts(list: MessageCounts[]): MessageCounts {
  return list.reduce(
    (acc, c) => ({ errors: acc.errors + c.errors, warnings: acc.warnings + c.warnings, info: acc.info + c.info }),
    { errors: 0, warnings: 0, info: 0 },
  );
}
