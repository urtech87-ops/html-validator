import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Text of every page, in reading order as pdf.js extracts it. */
export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  const pages = pdf.numPages;
  await task.destroy();
  return { pages, text: parts.join("\n") };
}

/** Embedded font names (e.g. "NotoSansArabic-Regular"), read from the PDF's font dictionaries. */
export function pdfFontNames(bytes: Uint8Array): string[] {
  const raw = new TextDecoder("latin1").decode(bytes);
  const names = new Set<string>();
  for (const m of raw.matchAll(/\/(?:BaseFont|FontName)\s*\/(?:[A-Z]{6}\+)?([^\s/<>[\]()]+)/g)) names.add(m[1]);
  return [...names];
}

/**
 * True when the letters of `word` appear as one contiguous run in `text`.
 * Chromium writes shaped Arabic in visual (reversed) order and keeps some
 * ligatures (e.g. "شر") in logical order inside that, so the run is compared
 * as a multiset of letters: presentation forms are folded (NFKC) and spaces
 * dropped. Tofu or missing glyphs leave no Arabic letters, so this still fails.
 */
export function containsArabic(text: string, word: string): boolean {
  const norm = (s: string) => [...s.normalize("NFKC").replace(/[\s·]+/g, "")];
  const hay = norm(text);
  const needle = norm(word);
  const key = (chars: string[]) => [...chars].sort().join("");
  const target = key(needle);
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (key(hay.slice(i, i + needle.length)) === target) return true;
  }
  return false;
}

/** U+FFFD or tofu-like characters that indicate missing glyphs in extracted text. */
export function hasReplacementChars(text: string): boolean {
  return /[�□]/.test(text);
}
