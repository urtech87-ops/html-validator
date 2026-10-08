import { describe, expect, it } from "vitest";
import { applyCssOptions, applyVerbosity, findVendorPrefixes } from "@/lib/validation/css-options";
import type { ValidationMessage } from "@/lib/validation/types";

const m = (patch: Partial<ValidationMessage>): ValidationMessage => ({
  id: Math.random().toString(36),
  severity: "error",
  category: "css",
  source: "vnu",
  message: "x",
  ...patch,
});

describe("applyCssOptions", () => {
  const msgs = [
    m({ severity: "error", message: "css error" }),
    m({ severity: "warning", message: "css warning" }),
    m({ severity: "info", message: "css info" }),
    m({ severity: "warning", category: "html", message: "html warning" }),
  ];
  const texts = (level: "none" | "normal" | "more" | "all") =>
    applyCssOptions(msgs, { warningLevel: level, vendorPrefixes: "ignore" }).map((x) => x.message);

  it("filters CSS messages by warning level and leaves HTML alone", () => {
    expect(texts("none")).toEqual(["css error", "html warning"]);
    expect(texts("normal")).toEqual(["css error", "css warning", "html warning"]);
    expect(texts("more")).toEqual(["css error", "css warning", "css info", "html warning"]);
    expect(texts("all")).toEqual(texts("more"));
  });

  it("drops vnu messages about vendor-prefixed properties when ignoring them", () => {
    const vendor = m({ message: "“-webkit-foo”: Property “-webkit-foo” doesn't exist." });
    expect(applyCssOptions([vendor], { warningLevel: "normal", vendorPrefixes: "ignore" })).toHaveLength(0);
    expect(applyCssOptions([vendor], { warningLevel: "normal", vendorPrefixes: "warn" })).toHaveLength(1);
  });
});

describe("applyVerbosity", () => {
  it("hides plain info unless verbose, but keeps CSS info at level more/all", () => {
    const msgs = [m({ severity: "info", category: "html" }), m({ severity: "info", category: "css" }), m({ severity: "error" })];
    expect(applyVerbosity(msgs, true, "normal")).toHaveLength(3);
    expect(applyVerbosity(msgs, false, "normal")).toHaveLength(1);
    expect(applyVerbosity(msgs, false, "more")).toHaveLength(2);
  });
});

describe("findVendorPrefixes", () => {
  it("finds prefixed properties in a stylesheet with exact positions", () => {
    const css = "a {\n  color: red;\n  -webkit-transition: none; -moz-box-sizing: border-box;\n}";
    const found = findVendorPrefixes(css, "css", "doc");
    expect(found.map((f) => [f.firstLine, f.firstColumn, f.lastColumn])).toEqual([
      [3, 3, 20],
      [3, 29, 43],
    ]);
    expect(found[0]).toMatchObject({ severity: "warning", category: "css", source: "markuplens" });
    expect(found[0].extract!.substr(found[0].hiliteStart!, found[0].hiliteLength!)).toBe("-webkit-transition");
  });

  it("only looks inside <style> and style attributes in HTML", () => {
    const html = '<p>-webkit-text: not css</p>\n<style>\nb { -ms-flex: 1 }\n</style>\n<div style="-o-transition: x">';
    const found = findVendorPrefixes(html, "html", "doc");
    expect(found.map((f) => [f.firstLine, f.message.match(/“(.+)”/)![1]])).toEqual([
      [3, "-ms-flex"],
      [5, "-o-transition"],
    ]);
  });

  it("ignores prefixed values (not properties)", () => {
    expect(findVendorPrefixes("a { display: -webkit-box; }", "css", "d")).toHaveLength(0);
  });
});
