import type { MessageCategory, Severity, ValidationMessage } from "./types";

/** Client-side message filtering, sorting and grouping for the results view. Pure functions. */

export type SortOrder = "line" | "severity" | "frequency";

export interface MessageQuery {
  severities: Record<Severity, boolean>;
  category: MessageCategory | "all";
  search: string;
}

export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function filterMessages(
  messages: ValidationMessage[],
  query: MessageQuery,
  isHiddenByUser: (m: ValidationMessage) => boolean = () => false,
): { visible: ValidationMessage[]; hiddenByUser: number } {
  const needle = query.search.trim().toLowerCase();
  let hiddenByUser = 0;
  const visible = messages.filter((m) => {
    if (!query.severities[m.severity]) return false;
    if (query.category !== "all" && m.category !== query.category) return false;
    if (needle && !m.message.toLowerCase().includes(needle) && !(m.extract ?? "").toLowerCase().includes(needle)) {
      return false;
    }
    if (isHiddenByUser(m)) {
      hiddenByUser++;
      return false;
    }
    return true;
  });
  return { visible, hiddenByUser };
}

function byLine(a: ValidationMessage, b: ValidationMessage) {
  // Messages without a location (document-level) come first.
  return (a.firstLine ?? 0) - (b.firstLine ?? 0) || (a.firstColumn ?? 0) - (b.firstColumn ?? 0);
}

export function frequencies(messages: ValidationMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.message, (counts.get(m.message) ?? 0) + 1);
  return counts;
}

export function sortMessages(messages: ValidationMessage[], order: SortOrder): ValidationMessage[] {
  const list = [...messages];
  if (order === "line") return list.sort(byLine);
  if (order === "severity") return list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || byLine(a, b));
  const freq = frequencies(messages);
  return list.sort(
    (a, b) =>
      (freq.get(b.message) ?? 0) - (freq.get(a.message) ?? 0) ||
      a.message.localeCompare(b.message) ||
      byLine(a, b),
  );
}

export interface MessageGroup {
  /** The shared message text. */
  key: string;
  severity: Severity;
  category: MessageCategory;
  items: ValidationMessage[];
}

/** Group identical messages (same text and severity), e.g. “Duplicate ID “menu”” ×12. */
export function groupMessages(messages: ValidationMessage[], order: SortOrder): MessageGroup[] {
  const groups = new Map<string, MessageGroup>();
  for (const m of sortMessages(messages, "line")) {
    const key = `${m.severity}\u0000${m.message}`;
    const group = groups.get(key);
    if (group) group.items.push(m);
    else groups.set(key, { key: m.message, severity: m.severity, category: m.category, items: [m] });
  }
  const list = [...groups.values()];
  const firstLine = (g: MessageGroup) => g.items[0].firstLine ?? 0;
  if (order === "line") return list.sort((a, b) => firstLine(a) - firstLine(b));
  if (order === "severity") {
    return list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || firstLine(a) - firstLine(b));
  }
  return list.sort((a, b) => b.items.length - a.items.length || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Split an extract into [before, highlighted, after] using vnu's hiliteStart/hiliteLength. */
export function splitExtract(extract: string, start?: number, length?: number): [string, string, string] {
  if (start === undefined || length === undefined || start < 0 || start > extract.length) return [extract, "", ""];
  return [extract.slice(0, start), extract.slice(start, start + length), extract.slice(start + length)];
}

export function formatLocation(m: ValidationMessage): string | undefined {
  if (m.lastLine === undefined) return undefined;
  const from = m.firstLine ?? m.lastLine;
  if (from === m.lastLine) {
    if (m.firstColumn !== undefined && m.lastColumn !== undefined && m.firstColumn !== m.lastColumn) {
      return `Line ${from}, columns ${m.firstColumn}–${m.lastColumn}`;
    }
    return m.lastColumn !== undefined ? `Line ${from}, column ${m.firstColumn ?? m.lastColumn}` : `Line ${from}`;
  }
  return `Lines ${from}–${m.lastLine}`;
}
