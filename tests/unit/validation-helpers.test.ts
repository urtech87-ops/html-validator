import { describe, expect, it } from "vitest";
import { detectDoctype } from "@/lib/validation/doctype";
import { compileFilters, escapeRegex, parseFilters, regexError } from "@/lib/validation/message-filters";
import { DEFAULT_OPTIONS, parseOptions } from "@/lib/validation/options";
import { computeScore, countMessages, sumCounts } from "@/lib/validation/score";
import { discoverStyles } from "@/lib/validation/stylesheets";
import { checkUpload, looksBinary } from "@/lib/validation/upload";
import type { ValidationMessage } from "@/lib/validation/types";

const msg = (message: string, severity: ValidationMessage["severity"] = "error"): ValidationMessage => ({
  id: message,
  severity,
  category: "html",
  source: "vnu",
  message,
});

describe("score", () => {
  it("is 100 − 5×errors − 1×warnings, floored at 0", () => {
    expect(computeScore({ errors: 0, warnings: 0, info: 9 })).toBe(100);
    expect(computeScore({ errors: 3, warnings: 4, info: 0 })).toBe(81);
    expect(computeScore({ errors: 30, warnings: 0, info: 0 })).toBe(0);
  });
  it("counts and sums", () => {
    const c = countMessages([msg("a"), msg("b", "warning"), msg("c", "info"), msg("d")]);
    expect(c).toEqual({ errors: 2, warnings: 1, info: 1 });
    expect(sumCounts([c, c])).toEqual({ errors: 4, warnings: 2, info: 2 });
  });
});

describe("detectDoctype", () => {
  it("recognises HTML5, legacy and missing doctypes", () => {
    expect(detectDoctype("<!DOCTYPE html>\n<html>", "html").kind).toBe("html5");
    expect(detectDoctype("﻿<!-- c -->\n<!doctype HTML>", "html").label).toBe("HTML5");
    expect(detectDoctype('<!DOCTYPE html SYSTEM "about:legacy-compat">', "html").kind).toBe("html5");
    expect(detectDoctype('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">', "html")).toMatchObject({ kind: "legacy", label: "HTML 4.01 Transitional" });
    expect(detectDoctype('<?xml version="1.0"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "x">', "xhtml").label).toBe("XHTML 1.0 Strict");
    expect(detectDoctype("<html>", "html").kind).toBe("missing");
    expect(detectDoctype("a{}", "css").kind).toBe("not-applicable");
  });
});

describe("parseOptions", () => {
  it("fills defaults and rejects invalid values", () => {
    expect(parseOptions(undefined)).toEqual(DEFAULT_OPTIONS);
    const o = parseOptions({ encoding: { override: "bogus" }, grouping: "by-type", verbose: "yes", css: { warningLevel: "all" } });
    expect(o.encoding.override).toBe("auto");
    expect(o.grouping).toBe("by-type");
    expect(o.verbose).toBe(false);
    expect(o.css).toEqual({ warningLevel: "all", vendorPrefixes: "ignore" });
  });
});

describe("message filters", () => {
  it("matches substrings case-insensitively and regexes", () => {
    const hide = compileFilters([
      { id: "1", pattern: "trailing SLASH", isRegex: false },
      { id: "2", pattern: "^Duplicate ID “nav", isRegex: true },
      { id: "3", pattern: "(", isRegex: true }, // invalid → ignored
    ]);
    expect(hide(msg("Trailing slash on void elements has no effect."))).toBe(true);
    expect(hide(msg("Duplicate ID “nav-main”."))).toBe(true);
    expect(hide(msg("Duplicate ID “menu”."))).toBe(false);
  });
  it("escapes text for exact-match filters and validates regexes", () => {
    const pattern = `^${escapeRegex("Bad value “a.b” (x)?")}$`;
    expect(new RegExp(pattern).test("Bad value “a.b” (x)?")).toBe(true);
    expect(regexError("(")).toBeTruthy();
    expect(regexError("a+")).toBeUndefined();
  });
  it("parses stored filters defensively", () => {
    expect(parseFilters("nope")).toEqual([]);
    expect(parseFilters([{ id: "a", pattern: "x", isRegex: false }, { id: 1 }])).toHaveLength(1);
  });
});

describe("discoverStyles", () => {
  it("finds stylesheets, resolves them against <base>, de-duplicates, counts <style>", () => {
    const html = `<head>
      <base href="https://cdn.example.com/assets/">
      <link rel="stylesheet" href="main.css">
      <link rel="STYLESHEET preload" href="/print.css#x">
      <link rel="stylesheet" href="main.css">
      <link rel="icon" href="favicon.ico">
      <link rel="stylesheet" href="data:text/css,a{}">
      <style>a{}</style><style>b{}</style>
    </head>`;
    const found = discoverStyles(html, "https://example.com/page");
    expect(found.stylesheets).toEqual(["https://cdn.example.com/assets/main.css", "https://cdn.example.com/print.css"]);
    expect(found.inlineStyleBlocks).toBe(2);
    expect(found.skipped).toBe(0);
  });
  it("caps the number of stylesheets", () => {
    const links = Array.from({ length: 25 }, (_, i) => `<link rel="stylesheet" href="/s${i}.css">`).join("");
    const found = discoverStyles(links, "https://example.com/");
    expect(found.stylesheets).toHaveLength(20);
    expect(found.skipped).toBe(5);
  });
});

describe("upload checks", () => {
  const text = new TextEncoder().encode("<p>x</p>");
  it("accepts allowed extensions and MIME types", () => {
    expect(checkUpload("a.HTML", "text/html", 10, text)).toEqual({ ok: true, kind: "html" });
    expect(checkUpload("a.xhtml", "", 10, text)).toEqual({ ok: true, kind: "xhtml" });
    expect(checkUpload("a.svg", "image/svg+xml", 10, text)).toEqual({ ok: true, kind: "svg" });
    expect(checkUpload("a.css", "text/css", 10, text)).toEqual({ ok: true, kind: "css" });
  });
  it("rejects wrong extensions, MIME types, sizes and binaries", () => {
    expect(checkUpload("a.zip", "application/zip", 10).ok).toBe(false);
    expect(checkUpload("a.html", "application/zip", 10).ok).toBe(false);
    expect(checkUpload("a.html", "text/html", 0).ok).toBe(false);
    expect(checkUpload("a.html", "text/html", 6 * 1024 * 1024).ok).toBe(false);
    expect(checkUpload("a.html", "text/html", 8, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toMatchObject({ ok: false });
  });
  it("detects binary content but allows UTF-16 text", () => {
    expect(looksBinary(new Uint8Array([0x3c, 0x00, 0x70]))).toBe("binary file");
    expect(looksBinary(new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))).toBeUndefined();
    expect(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("PNG image");
  });
});

describe("upload hardening", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new TextEncoder().encode("<!doctype html><title>x</title>")]);

  it("refuses archives and binaries renamed to an accepted extension", () => {
    const cases: Array<[string, Uint8Array]> = [
      ["ZIP archive", bytes(0x50, 0x4b, 0x03, 0x04)],
      ["ZIP archive", bytes(0x50, 0x4b, 0x05, 0x06)],
      ["BZIP2 archive", bytes(0x42, 0x5a, 0x68, 0x39)],
      ["XZ archive", bytes(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00)],
      ["Zstandard archive", bytes(0x28, 0xb5, 0x2f, 0xfd)],
      ["Microsoft Office document", bytes(0xd0, 0xcf, 0x11, 0xe0)],
      ["Java class file", bytes(0xca, 0xfe, 0xba, 0xbe)],
      ["RIFF media file", bytes(0x52, 0x49, 0x46, 0x46)],
      ["Windows executable", bytes(0x4d, 0x5a, 0x90)],
      ["PDF document", new TextEncoder().encode("%PDF-1.7 <html>")],
    ];
    for (const [label, content] of cases) {
      expect(checkUpload("page.html", "text/html", content.byteLength, content), label).toEqual({
        ok: false,
        error: `“page.html” looks like a ${label}, not a text file.`,
      });
    }
    const tar = new Uint8Array(1024).fill(0x20);
    tar.set(new TextEncoder().encode("ustar"), 257);
    expect(looksBinary(tar)).toBe("TAR archive");
    expect(looksBinary(new TextEncoder().encode("BZh is not a bzip2 file"))).toBeUndefined();
  });

  it("refuses NUL bytes in a non-UTF-16 file, accepts UTF-16 with a BOM", () => {
    expect(checkUpload("a.css", "text/css", 6, new Uint8Array([0x61, 0x7b, 0x00, 0x7d, 0x0a, 0x0a])).ok).toBe(false);
    const utf16 = new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00, 0x3e, 0x00]);
    expect(checkUpload("a.html", "text/html", utf16.byteLength, utf16)).toEqual({ ok: true, kind: "html" });
  });

  it("judges by the last extension: double extensions don't sneak archives in", () => {
    expect(checkUpload("site.html.zip", "application/zip", 10).ok).toBe(false);
    expect(checkUpload("site.zip.html", "text/html", 8, bytes(0x50, 0x4b, 0x03, 0x04)).ok).toBe(false);
    expect(checkUpload("noextension", "text/html", 10).ok).toBe(false);
    expect(checkUpload(".html", "text/html", 10, bytes()).ok).toBe(true);
  });

  it("accepts MIME parameters, refuses mismatched types", () => {
    expect(checkUpload("a.html", "text/html; charset=utf-8", 10, bytes()).ok).toBe(true);
    expect(checkUpload("a.html", "TEXT/HTML", 10, bytes()).ok).toBe(true);
    for (const mime of ["application/zip", "application/x-msdownload", "image/png", "application/javascript", "text/javascript"]) {
      expect(checkUpload("a.html", mime, 10, bytes()).ok, mime).toBe(false);
    }
  });

  it("size limits: empty and over 5 MB are refused, exactly 5 MB is fine", () => {
    expect(checkUpload("a.html", "text/html", 0).ok).toBe(false);
    expect(checkUpload("a.html", "text/html", 5 * 1024 * 1024).ok).toBe(true);
    expect(checkUpload("a.html", "text/html", 5 * 1024 * 1024 + 1).ok).toBe(false);
  });
});
