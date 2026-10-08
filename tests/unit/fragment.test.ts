import { describe, expect, it } from "vitest";
import { FRAGMENT_PREFIX_LINES, lineCount, mapFragmentMessage, wrapFragment } from "@/lib/vnu/fragment";
import type { ValidationMessage } from "@/lib/validation/types";

const msg = (patch: Partial<ValidationMessage>): ValidationMessage => ({
  id: "m",
  severity: "error",
  category: "html",
  source: "vnu",
  message: "x",
  ...patch,
});

describe("fragment wrapping", () => {
  it("puts the fragment's first line right after the prefix", () => {
    const wrapped = wrapFragment("<p>a</p>\n<img src=x>");
    const lines = wrapped.split("\n");
    expect(lines[FRAGMENT_PREFIX_LINES]).toBe("<p>a</p>");
    expect(lines[FRAGMENT_PREFIX_LINES + 1]).toBe("<img src=x>");
    expect(wrapped.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("maps lines back onto the user's input", () => {
    const mapped = mapFragmentMessage(msg({ firstLine: FRAGMENT_PREFIX_LINES + 2, lastLine: FRAGMENT_PREFIX_LINES + 2, firstColumn: 1, lastColumn: 11 }), 2);
    expect(mapped).toMatchObject({ firstLine: 2, lastLine: 2, firstColumn: 1, lastColumn: 11 });
  });

  it("clamps messages located in the wrapper", () => {
    const inSuffix = mapFragmentMessage(msg({ firstLine: FRAGMENT_PREFIX_LINES + 5, lastLine: FRAGMENT_PREFIX_LINES + 5, lastColumn: 7 }), 2);
    expect(inSuffix).toMatchObject({ firstLine: 2, lastLine: 2, lastColumn: undefined });
    const inPrefix = mapFragmentMessage(msg({ firstLine: 2, lastLine: 2, firstColumn: 3, lastColumn: 4 }), 2);
    expect(inPrefix).toMatchObject({ firstLine: 1, lastLine: 1, firstColumn: undefined });
  });

  it("leaves unlocated messages alone", () => {
    const m = msg({});
    expect(mapFragmentMessage(m, 3)).toBe(m);
  });

  it("counts lines across newline styles", () => {
    expect(lineCount("")).toBe(1);
    expect(lineCount("a\r\nb\rc\nd")).toBe(4);
  });
});
