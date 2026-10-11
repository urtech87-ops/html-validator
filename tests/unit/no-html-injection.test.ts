import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { downloadHeaders } from "@/lib/report/filename";

/**
 * User documents (fetched pages, uploads, direct input) must only ever be
 * shown as text. React escapes text by default; these checks make sure no
 * component opts out of that.
 */

const srcDir = path.resolve(import.meta.dirname, "../../src");
const files: string[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated") walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
};
walk(srcDir);
const rel = (f: string) => path.relative(srcDir, f).replaceAll("\\", "/");

describe("no user content rendered as HTML", () => {
  it("dangerouslySetInnerHTML only in the static theme script", () => {
    const users = files.filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML")).map(rel);
    expect(users).toEqual(["components/theme/theme-script.tsx"]);
  });

  it("the theme script injects only a constant", () => {
    const source = readFileSync(path.join(srcDir, "components/theme/theme-script.tsx"), "utf8");
    expect(source).toMatch(/__html: script\b/);
    expect(source).not.toMatch(/props|searchParams|params/);
  });

  it("no DOM HTML sinks in client code", () => {
    const sinks = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(|srcDoc=|new DOMParser|createContextualFragment/;
    const offenders = files.filter((f) => !rel(f).startsWith("lib/report/") && sinks.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("HTML report downloads are sandboxed and never sniffed", () => {
    const html = downloadHeaders("text/html; charset=utf-8", "r.html");
    expect(html["Content-Security-Policy"]).toMatch(/^sandbox; default-src 'none'/);
    expect(html["Content-Disposition"]).toMatch(/^attachment;/);
    expect(html["X-Content-Type-Options"]).toBe("nosniff");
    expect(downloadHeaders("application/pdf", "r.pdf")["Content-Security-Policy"]).toBeUndefined();
  });
});
