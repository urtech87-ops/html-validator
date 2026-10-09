import { describe, expect, it } from "vitest";
import { filterMessages, formatLocation, groupMessages, sortMessages, splitExtract } from "@/lib/validation/view";
import type { ValidationMessage } from "@/lib/validation/types";

let n = 0;
const m = (patch: Partial<ValidationMessage>): ValidationMessage => ({
  id: `m${++n}`,
  severity: "error",
  category: "html",
  source: "vnu",
  message: "x",
  ...patch,
});

const all = { error: true, warning: true, info: true };

describe("filterMessages", () => {
  const msgs = [
    m({ message: "Duplicate ID “menu”.", firstLine: 5 }),
    m({ message: "Stray end tag", severity: "warning", firstLine: 2, extract: "</div>" }),
    m({ message: "CSS: bad", category: "css", severity: "info", firstLine: 9 }),
  ];

  it("filters by severity, category and search (message or extract)", () => {
    expect(filterMessages(msgs, { severities: { ...all, warning: false }, category: "all", search: "" }).visible).toHaveLength(2);
    expect(filterMessages(msgs, { severities: all, category: "css", search: "" }).visible).toHaveLength(1);
    expect(filterMessages(msgs, { severities: all, category: "all", search: "MENU" }).visible).toHaveLength(1);
    expect(filterMessages(msgs, { severities: all, category: "all", search: "</div" }).visible).toHaveLength(1);
  });

  it("counts messages hidden by user filters", () => {
    const res = filterMessages(msgs, { severities: all, category: "all", search: "" }, (x) => x.message.startsWith("Duplicate"));
    expect(res.visible).toHaveLength(2);
    expect(res.hiddenByUser).toBe(1);
  });
});

describe("sort and group", () => {
  const msgs = [
    m({ message: "B", firstLine: 10, severity: "warning" }),
    m({ message: "A", firstLine: 3 }),
    m({ message: "B", firstLine: 1, severity: "warning" }),
    m({ message: "C", firstLine: 7, severity: "info" }),
    m({ message: "B", firstLine: 4, severity: "warning" }),
  ];

  it("sorts by line, severity and frequency", () => {
    expect(sortMessages(msgs, "line").map((x) => x.firstLine)).toEqual([1, 3, 4, 7, 10]);
    expect(sortMessages(msgs, "severity").map((x) => x.message)).toEqual(["A", "B", "B", "B", "C"]);
    expect(sortMessages(msgs, "frequency").map((x) => x.message)).toEqual(["B", "B", "B", "A", "C"]);
  });

  it("groups identical messages with their occurrences in line order", () => {
    const groups = groupMessages(msgs, "frequency");
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ["B", 3],
      ["A", 1],
      ["C", 1],
    ]);
    expect(groups[0].items.map((x) => x.firstLine)).toEqual([1, 4, 10]);
    expect(groupMessages(msgs, "line").map((g) => g.key)).toEqual(["B", "A", "C"]);
  });
});

describe("splitExtract and formatLocation", () => {
  it("splits on the highlight range", () => {
    expect(splitExtract("abc<img>def", 3, 5)).toEqual(["abc", "<img>", "def"]);
    expect(splitExtract("abc", undefined, undefined)).toEqual(["abc", "", ""]);
    expect(splitExtract("abc", 10, 2)).toEqual(["abc", "", ""]);
  });

  it("describes positions", () => {
    expect(formatLocation(m({ firstLine: 4, lastLine: 4, firstColumn: 1, lastColumn: 20 }))).toBe("Line 4, columns 1–20");
    expect(formatLocation(m({ firstLine: 4, lastLine: 4, firstColumn: 7, lastColumn: 7 }))).toBe("Line 4, column 7");
    expect(formatLocation(m({ firstLine: 1, lastLine: 2, firstColumn: 91, lastColumn: 6 }))).toBe("Lines 1–2");
    expect(formatLocation(m({ lastLine: 3 }))).toBe("Line 3");
    expect(formatLocation(m({}))).toBeUndefined();
  });
});
