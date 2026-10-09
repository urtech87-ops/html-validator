import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchGuide, MESSAGE_GUIDE } from "@/lib/guide/messageGuide";

describe("message guide", () => {
  it("covers about 40+ common messages with unique ids", () => {
    expect(MESSAGE_GUIDE.length).toBeGreaterThanOrEqual(40);
    expect(new Set(MESSAGE_GUIDE.map((e) => e.id)).size).toBe(MESSAGE_GUIDE.length);
  });

  it("substitutes captured names into the explanation, fix and example", () => {
    const g = matchGuide("Duplicate ID “menu”.")!;
    expect(g.id).toBe("duplicate-id");
    expect(g.explanation).toContain('id="menu"');
    expect(g.example?.before).toContain('<nav id="menu">');

    const child = matchGuide("Element “p” not allowed as child of element “ul” in this context. (Suppressing further errors from this subtree.)")!;
    expect(child.id).toBe("not-allowed-as-child");
    expect(child.explanation).toContain("<p> directly inside <ul>");

    const req = matchGuide("Element “img” is missing required attribute “src”.")!;
    expect(req.explanation).toBe("<img> must have the src attribute to work correctly.");
  });

  it.each([
    ["Bad value “” for attribute “action” on element “form”: Must be non-empty.", "bad-value-empty"],
    ["Bad value “50%” for attribute “width” on element “img”: Expected a digit but saw “%” instead.", "bad-value"],
    ["CSS: “color”: “#ggg” is not a valid color 3 or 6 hexadecimals numbers.", "css-invalid-color"],
    ["CSS: “font-weight”: “heavy” is not a “font-weight” value.", "css-invalid-value"],
    ["“colr”: Property “colr” doesn't exist.", "css-unknown-property"],
    ["CSS: “margin”: Too many values or values are not recognized.", "css-too-many-values"],
    ["The heading “h3” (with computed level 3) follows the heading “h1” (with computed level 1), skipping 1 heading level.", "heading-skip"],
    ["The “navigation” role is unnecessary for element “nav”.", "unnecessary-role"],
    ["Start tag seen without seeing a doctype first. Expected “<!DOCTYPE html>”.", "doctype-missing"],
    ["Bad value  for attribute “src” on element “img”: Illegal character in query. “[” is not allowed.", "bad-value"],
    ["Bad value “a\"b” for attribute “href” on element “a”: Illegal character.", "bad-value"],
    ["CSS: only “0” can be a “unit”. You must put a unit after your number", "css-unit-required"],
    ["CSS: Style rule “.title” not allowed outside an “@media” rule in a “style” element in “body”.", "css-nested-rule"],
    ['“color”: Cannot invoke "org.w3c.css.values.CssValue.getType()" because "val" is null.', "css-checker-internal"],
    ["Element “link” is missing a required attribute “href”.", "missing-required-attribute"],
    ["Some brand-new message vnu added yesterday.", undefined],
  ])("%s → %s", (message, id) => {
    expect(matchGuide(message)?.id).toBe(id);
  });

  it("fills heading levels in the right order", () => {
    const g = matchGuide("The heading “h3” (with computed level 3) follows the heading “h1” (with computed level 1), skipping 1 heading level.")!;
    expect(g.explanation).toContain("An <h3> comes right after an <h1>");
  });

  it("explains every message in the acceptance fixtures", () => {
    const dir = path.resolve("tests", "fixtures");
    const messages = readdirSync(dir)
      .filter((f) => f.endsWith(".expected.json"))
      .flatMap((f) => (JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { messages: Array<{ message: string }> }).messages.map((m) => m.message));
    const unexplained = messages.filter((m) => !matchGuide(m));
    expect(unexplained).toEqual([]);
  });
});

describe("message guide placeholders", () => {
  it("keeps placeholder positions when an optional group is absent", () => {
    const g = matchGuide("Bad value  for attribute “src” on element “img”: Illegal character in query.")!;
    expect(g.explanation).toBe("The value of the src attribute on <img> is not valid. The detail after the colon (if any) says what was expected.");
    expect(matchGuide("Element “link” is missing a required attribute “href”.")!.fix).toBe("Add the href attribute with a valid value.");
  });
});
