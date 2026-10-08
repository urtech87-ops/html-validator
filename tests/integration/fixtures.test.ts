import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { DEFAULT_OPTIONS } from "@/lib/validation/options";
import { validateText } from "@/lib/validation/run";
import { callVnu } from "@/lib/vnu/client";
import { checkVnuHealth } from "@/lib/vnu/health";

/**
 * Acceptance: known-bad fixtures must produce exactly the messages recorded
 * from the pinned vnu image (tests/fixtures/*.expected.json, regenerated with
 * `npm run fixtures:update` only when VNU_IMAGE changes).
 */

const dir = path.resolve("tests", "fixtures");
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".html"));
const { vnuUrl } = getConfig();

interface Expected {
  vnuVersion: string;
  messages: Array<Record<string, unknown>>;
}

const pick = (m: Record<string, unknown>) => ({
  type: m.type,
  subType: m.subType,
  message: m.message,
  firstLine: m.firstLine,
  lastLine: m.lastLine,
  firstColumn: m.firstColumn,
  lastColumn: m.lastColumn,
});

beforeAll(async () => {
  const health = await checkVnuHealth(vnuUrl);
  if (!health.ok) throw new Error(`vnu is not available at ${vnuUrl} (${health.error}). Run: docker compose up -d vnu`);
});

describe("known-bad fixtures match the pinned vnu", () => {
  it("has three fixtures", () => expect(fixtures).toHaveLength(3));

  it.each(fixtures)("%s", async (file) => {
    const expected = JSON.parse(readFileSync(path.join(dir, file.replace(/\.html$/, ".expected.json")), "utf8")) as Expected;
    const res = await callVnu(vnuUrl, { body: readFileSync(path.join(dir, file)), mediaType: "text/html" }, 30_000);
    expect(res.version).toBe(expected.vnuVersion);
    expect(res.messages.map((m) => pick(m as Record<string, unknown>))).toEqual(expected.messages.map(pick));
  });
});

describe("validation pipeline against vnu", () => {
  it("maps fragment line numbers back to the user's input", async () => {
    const fragment = ["<nav id=menu></nav>", "<p>ok</p>", "<div id=menu></div>", "<img src=x.png>"].join("\n");
    const run = await validateText("html", fragment, true, DEFAULT_OPTIONS);
    const lines = run.documents[0].messages.map((m) => [m.severity, m.firstLine, m.message.slice(0, 20)]);
    expect(lines).toEqual([
      ["warning", 1, "The first occurrence"],
      ["error", 3, "Duplicate ID “menu”."],
      ["error", 4, "An “img” element mus"],
    ]);
  });

  it("validates CSS direct input and applies vendor-prefix warnings", async () => {
    const css = "a { colr: red; }\nb { -webkit-transition: none; }";
    const plain = await validateText("css", css, false, DEFAULT_OPTIONS);
    expect(plain.counts).toEqual({ errors: 1, warnings: 0, info: 0 });
    const warn = await validateText("css", css, false, { ...DEFAULT_OPTIONS, css: { warningLevel: "normal", vendorPrefixes: "warn" } });
    expect(warn.counts).toEqual({ errors: 1, warnings: 1, info: 0 });
    expect(warn.documents[0].messages[1]).toMatchObject({ firstLine: 2, firstColumn: 5, source: "markuplens" });
  });

  it("scores and passes a valid document", async () => {
    const run = await validateText("html", readFileSync(path.join(dir, "01-structure.html"), "utf8"), false, DEFAULT_OPTIONS);
    expect(run.passed).toBe(false);
    expect(run.score).toBe(Math.max(0, 100 - 5 * run.counts.errors - run.counts.warnings));
    const ok = await validateText("html", '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><p>x</p></body></html>', false, DEFAULT_OPTIONS);
    expect(ok).toMatchObject({ passed: true, score: 100, counts: { errors: 0, warnings: 0, info: 0 } });
  });
});
