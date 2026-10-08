import { describe, expect, it } from "vitest";
import { normalizeVnuMessages, vnuCategory, vnuSeverity } from "@/lib/vnu/normalize";

describe("vnuSeverity", () => {
  it("maps vnu types to severities", () => {
    expect(vnuSeverity({ type: "error" })).toBe("error");
    expect(vnuSeverity({ type: "error", subType: "fatal" })).toBe("error");
    expect(vnuSeverity({ type: "non-document-error", subType: "io" })).toBe("error");
    expect(vnuSeverity({ type: "info", subType: "warning" })).toBe("warning");
    expect(vnuSeverity({ type: "info" })).toBe("info");
  });
});

describe("vnuCategory", () => {
  it("detects CSS messages inside HTML by their prefix", () => {
    expect(vnuCategory({ type: "error", lastLine: 3, message: "CSS: “colr”: Property “colr” doesn't exist." }, false)).toBe("css");
    expect(vnuCategory({ type: "error", lastLine: 3, message: "Duplicate ID “a”." }, false)).toBe("html");
  });
  it("treats every located message in a CSS document as CSS", () => {
    expect(vnuCategory({ type: "error", lastLine: 1, message: "Parse Error." }, true)).toBe("css");
  });
  it("treats unlocated and non-document messages as document-level", () => {
    expect(vnuCategory({ type: "error", message: "The character encoding was not declared." }, false)).toBe("document");
    expect(vnuCategory({ type: "non-document-error", lastLine: 1, message: "IO" }, false)).toBe("document");
  });
});

describe("normalizeVnuMessages", () => {
  it("fills firstLine and firstColumn when vnu omits them", () => {
    const [m] = normalizeVnuMessages(
      [{ type: "error", lastLine: 2, lastColumn: 16, message: "Bad colour", extract: "a { color: #ggg }", hiliteStart: 15, hiliteLength: 1 }],
      "doc",
      true,
    );
    expect(m).toMatchObject({
      id: "doc:0",
      severity: "error",
      category: "css",
      source: "vnu",
      firstLine: 2,
      lastLine: 2,
      firstColumn: 16,
      lastColumn: 16,
      hiliteStart: 15,
      hiliteLength: 1,
    });
  });

  it("keeps an explicit multi-line range", () => {
    const [m] = normalizeVnuMessages([{ type: "info", subType: "warning", firstLine: 1, lastLine: 2, firstColumn: 91, lastColumn: 6, message: " x " }], "d", false);
    expect(m).toMatchObject({ firstLine: 1, lastLine: 2, firstColumn: 91, lastColumn: 6, severity: "warning", message: "x" });
  });
});
