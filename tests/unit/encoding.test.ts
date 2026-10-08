import { describe, expect, it } from "vitest";
import { charsetFromContentType, decideEncoding, decodeBytes, sniffBom, sniffMetaCharset } from "@/lib/fetch/encoding";
import { DEFAULT_OPTIONS } from "@/lib/validation/options";

const enc = (s: string) => new TextEncoder().encode(s);
const auto = DEFAULT_OPTIONS.encoding;

describe("encoding detection", () => {
  it("reads charset from Content-Type", () => {
    expect(charsetFromContentType("text/html; charset=ISO-8859-1")).toBe("iso-8859-1");
    expect(charsetFromContentType('text/html; charset="utf-8"')).toBe("utf-8");
    expect(charsetFromContentType("text/html")).toBeUndefined();
  });

  it("detects BOMs and meta charset", () => {
    expect(sniffBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c]))).toBe("utf-8");
    expect(sniffBom(new Uint8Array([0xff, 0xfe]))).toBe("utf-16le");
    expect(sniffMetaCharset(enc('<html><head><meta charset="windows-1256">'))).toBe("windows-1256");
    expect(sniffMetaCharset(enc('<meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">'))).toBe("shift_jis");
  });

  it("prefers BOM over header over meta", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('<meta charset="iso-8859-1">')]);
    expect(decideEncoding(bytes, { contentType: "text/html; charset=windows-1252", isCss: false, options: auto }).info).toMatchObject({ name: "utf-8", source: "bom" });
    expect(decideEncoding(enc('<meta charset="iso-8859-1">'), { contentType: "text/html; charset=windows-1252", isCss: false, options: auto }).info.source).toBe("http-header");
  });

  it("forwards only header charsets to vnu in auto mode", () => {
    expect(decideEncoding(enc("x"), { contentType: "text/html; charset=utf-8", isCss: false, options: auto }).charsetForVnu).toBe("utf-8");
    expect(decideEncoding(enc('<meta charset="utf-8">'), { contentType: "text/html", isCss: false, options: auto }).charsetForVnu).toBeUndefined();
  });

  it("applies overrides, honouring “only if missing”", () => {
    const override = { override: "windows-1256" as const, onlyIfMissing: false };
    const d1 = decideEncoding(enc('<meta charset="utf-8">'), { contentType: null, isCss: false, options: override });
    expect(d1).toMatchObject({ charsetForVnu: "windows-1256", info: { name: "windows-1256", source: "override", declared: "utf-8" } });

    const onlyIfMissing = { ...override, onlyIfMissing: true };
    expect(decideEncoding(enc('<meta charset="utf-8">'), { contentType: null, isCss: false, options: onlyIfMissing }).info.source).toBe("meta");
    expect(decideEncoding(enc("<p>x</p>"), { contentType: null, isCss: false, options: onlyIfMissing }).info.source).toBe("override");
  });

  it("detects CSS @charset", () => {
    expect(decideEncoding(enc('@charset "iso-8859-1";\na{}'), { contentType: "text/css", isCss: true, options: auto }).info).toMatchObject({ name: "iso-8859-1", source: "css-charset" });
  });

  it("falls back to UTF-8 or windows-1252 when nothing is declared", () => {
    expect(decideEncoding(enc("café"), { contentType: null, isCss: false, options: auto }).info).toMatchObject({ name: "utf-8", source: "fallback" });
    expect(decideEncoding(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), { contentType: null, isCss: false, options: auto }).info.name).toBe("windows-1252");
  });

  it("decodes legacy encodings", () => {
    expect(decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), "windows-1252")).toBe("café");
    expect(decodeBytes(new Uint8Array([0xc7, 0xe1]), "windows-1256")).toBe("ال");
    expect(decodeBytes(enc("ok"), "no-such-encoding")).toBe("ok");
  });
});
