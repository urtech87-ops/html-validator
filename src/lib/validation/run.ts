import "server-only";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { decideEncoding, decodeBytes } from "@/lib/fetch/encoding";
import { FetchFailedError, safeFetch } from "@/lib/fetch/safe-fetch";
import { BlockedUrlError } from "@/lib/fetch/ssrf";
import { callVnu, VnuError } from "@/lib/vnu/client";
import { lineCount, mapFragmentMessage, wrapFragment } from "@/lib/vnu/fragment";
import { normalizeVnuMessages } from "@/lib/vnu/normalize";
import { applyCssOptions, applyVerbosity, findVendorPrefixes } from "./css-options";
import { detectDoctype, LEGACY_DOCTYPE_NOTICE } from "./doctype";
import { USER_AGENTS, type ValidationOptions } from "./options";
import { computeScore, countMessages, sumCounts } from "./score";
import { discoverStyles } from "./stylesheets";
import type {
  DocumentKind,
  DocumentOrigin,
  DocumentResult,
  EncodingInfo,
  RunInput,
  RunResult,
  ValidationMessage,
} from "./types";

const MEDIA_TYPES: Record<DocumentKind, string> = {
  html: "text/html",
  xhtml: "application/xhtml+xml",
  css: "text/css",
  svg: "image/svg+xml",
};

/** Map a response Content-Type to a document kind; undefined if it can't be validated. */
export function kindFromContentType(contentType: string | null): DocumentKind | undefined {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "" || type === "text/html") return "html";
  if (type === "application/xhtml+xml") return "xhtml";
  if (type === "text/css") return "css";
  if (type === "image/svg+xml") return "svg";
  return undefined;
}

interface DocumentInput {
  id: string;
  label: string;
  kind: DocumentKind;
  origin: DocumentOrigin;
  options: ValidationOptions;
  url?: string;
  httpStatus?: number;
  contentType?: string | null;
  fetchMs?: number;
  notices?: string[];
  inlineStyleBlocks?: number;
  /** Raw bytes (URL / upload) — encoding is detected. */
  bytes?: Uint8Array;
  /** Text (direct input) — always UTF-8. */
  text?: string;
  /** Direct input only: wrap in an HTML5 skeleton and map lines back. */
  fragment?: boolean;
}

interface DocumentOutput {
  result: DocumentResult;
  engineVersion?: string;
}

function emptyResult(input: DocumentInput, source: string, sizeBytes: number, encoding: EncodingInfo): DocumentResult {
  return {
    id: input.id,
    label: input.label,
    kind: input.kind,
    origin: input.origin,
    url: input.url,
    source,
    sizeBytes,
    encoding,
    doctype: detectDoctype(source, input.kind),
    httpStatus: input.httpStatus,
    contentType: input.contentType ?? undefined,
    fetchMs: input.fetchMs,
    inlineStyleBlocks: input.inlineStyleBlocks,
    notices: [...(input.notices ?? [])],
    messages: [],
    counts: { errors: 0, warnings: 0, info: 0 },
    score: 0,
    passed: false,
  };
}

export function fatalResult(input: DocumentInput, fatal: string): DocumentResult {
  const result = emptyResult(input, "", 0, { name: "—", source: "fallback" });
  result.doctype = { kind: "not-applicable", label: "—" };
  result.fatal = fatal;
  result.counts = { errors: 1, warnings: 0, info: 0 };
  result.messages = [
    { id: `${input.id}:fatal`, severity: "error", category: "document", source: "markuplens", message: fatal },
  ];
  result.score = computeScore(result.counts);
  return result;
}

/** Validate one document with vnu and post-process the messages. */
export async function validateDocument(input: DocumentInput): Promise<DocumentOutput> {
  const config = getConfig();
  const isCss = input.kind === "css";

  let body: Uint8Array | string;
  let source: string;
  let sizeBytes: number;
  let encoding: EncodingInfo;
  let charsetForVnu: string | undefined;

  if (input.text !== undefined) {
    source = input.text;
    body = input.fragment ? wrapFragment(input.text) : input.text;
    sizeBytes = new TextEncoder().encode(input.text).byteLength;
    encoding = { name: "utf-8", source: "direct-input" };
    charsetForVnu = "utf-8";
  } else {
    const bytes = input.bytes ?? new Uint8Array();
    const decision = decideEncoding(bytes, { contentType: input.contentType, isCss, options: input.options.encoding });
    body = bytes;
    source = decodeBytes(bytes, decision.info.name);
    sizeBytes = bytes.byteLength;
    encoding = decision.info;
    charsetForVnu = decision.charsetForVnu;
  }

  const result = emptyResult(input, source, sizeBytes, encoding);
  if (input.fragment) result.doctype = { kind: "not-applicable", label: "Fragment (wrapped in HTML5)" };
  if (result.doctype.kind === "legacy") result.notices.push(LEGACY_DOCTYPE_NOTICE);

  let vnu;
  try {
    vnu = await callVnu(config.vnuUrl, { body, mediaType: MEDIA_TYPES[input.kind], charset: charsetForVnu }, config.vnuTimeoutMs);
  } catch (err) {
    if (err instanceof VnuError) return { result: { ...fatalResult(input, err.message), source, sizeBytes, encoding } };
    throw err;
  }
  result.validateMs = vnu.elapsedMs;

  let messages: ValidationMessage[] = normalizeVnuMessages(vnu.messages, input.id, isCss);
  if (input.fragment) {
    const lines = lineCount(input.text ?? "");
    messages = messages.map((m) => mapFragmentMessage(m, lines));
  }
  if (input.options.css.vendorPrefixes === "warn") {
    messages = [...messages, ...findVendorPrefixes(source, input.kind, input.id)];
  }
  messages = applyCssOptions(messages, input.options.css);
  messages = applyVerbosity(messages, input.options.verbose, input.options.css.warningLevel);
  messages.sort((a, b) => (a.firstLine ?? 0) - (b.firstLine ?? 0) || (a.firstColumn ?? 0) - (b.firstColumn ?? 0));

  result.messages = messages;
  result.counts = countMessages(messages);
  result.score = computeScore(result.counts);
  result.passed = result.counts.errors === 0;
  return { result, engineVersion: vnu.version };
}

function finalizeRun(input: RunInput, docs: DocumentOutput[], started: number): RunResult {
  const documents = docs.map((d) => d.result);
  const counts = sumCounts(documents.map((d) => d.counts));
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    input,
    documents,
    counts,
    score: computeScore(counts),
    passed: counts.errors === 0,
    engineVersion: docs.find((d) => d.engineVersion)?.engineVersion,
    durationMs: Math.round(performance.now() - started),
  };
}

function fetchErrorMessage(err: unknown): string {
  if (err instanceof BlockedUrlError || err instanceof FetchFailedError) return err.message;
  throw err;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Validate a URL: the page itself plus every linked stylesheet (inline CSS is checked by vnu in the HTML pass). */
export async function validateUrl(url: string, options: ValidationOptions): Promise<RunResult> {
  const started = performance.now();
  const config = getConfig();
  const fetchOpts = {
    userAgent: USER_AGENTS[options.userAgent].value,
    allowPrivateUrls: config.allowPrivateUrls,
    runningInDocker: config.runningInDocker,
  };
  const runInput: RunInput = { type: "url", target: url.trim() };
  const base = { id: "page", label: url.trim(), kind: "html" as const, origin: "url" as const, options };

  let page;
  try {
    page = await safeFetch(url, fetchOpts);
  } catch (err) {
    return finalizeRun(runInput, [{ result: fatalResult(base, fetchErrorMessage(err)) }], started);
  }

  const kind = kindFromContentType(page.contentType);
  const pageInput = {
    ...base,
    label: page.finalUrl,
    kind: kind ?? "html",
    url: page.finalUrl,
    httpStatus: page.status,
    contentType: page.contentType,
    fetchMs: page.elapsedMs,
    notices: page.redirects.length ? [`Redirected ${page.redirects.length}×: ${[page.requestedUrl, ...page.redirects].join(" → ")}`] : [],
  };
  runInput.target = page.requestedUrl;

  if (!kind) {
    return finalizeRun(runInput, [{ result: fatalResult(pageInput, `Unsupported content type “${page.contentType}”. Only HTML, XHTML, CSS and SVG can be validated.`) }], started);
  }
  if (page.status >= 400 && !options.validateErrorPages) {
    return finalizeRun(
      runInput,
      [{ result: fatalResult(pageInput, `The server returned HTTP ${page.status}${page.statusText ? ` ${page.statusText}` : ""}. Turn on “Validate error pages” to validate it anyway.`) }],
      started,
    );
  }
  if (page.status >= 400) pageInput.notices.push(`The server returned HTTP ${page.status}; validated anyway (“Validate error pages” is on).`);

  if (kind === "css" || kind === "svg") {
    const doc = await validateDocument({ ...pageInput, bytes: page.bytes });
    return finalizeRun(runInput, [doc], started);
  }

  // Validate the page and discover its stylesheets in parallel.
  const pagePromise = validateDocument({ ...pageInput, bytes: page.bytes });
  const preliminary = decideEncoding(page.bytes, { contentType: page.contentType, isCss: false, options: options.encoding });
  const styles = discoverStyles(decodeBytes(page.bytes, preliminary.info.name), page.finalUrl);
  const cssDocs = await mapLimit(styles.stylesheets, 4, async (href, i) => {
    const input = { id: `css-${i + 1}`, label: href, kind: "css" as const, origin: "stylesheet" as const, options, url: href };
    try {
      const sheet = await safeFetch(href, { ...fetchOpts, accept: "text/css,*/*;q=0.1" });
      const sheetInput = { ...input, url: sheet.finalUrl, label: sheet.finalUrl, httpStatus: sheet.status, contentType: sheet.contentType, fetchMs: sheet.elapsedMs };
      if (sheet.status >= 400) return { result: fatalResult(sheetInput, `Stylesheet returned HTTP ${sheet.status}.`) };
      return await validateDocument({ ...sheetInput, bytes: sheet.bytes });
    } catch (err) {
      return { result: fatalResult(input, `Stylesheet could not be fetched: ${fetchErrorMessage(err)}`) };
    }
  });

  const pageDoc = await pagePromise;
  pageDoc.result.inlineStyleBlocks = styles.inlineStyleBlocks;
  if (styles.skipped > 0) {
    pageDoc.result.notices.push(`${styles.skipped} more linked stylesheet(s) were not checked (limit is ${styles.stylesheets.length}).`);
  }
  return finalizeRun(runInput, [pageDoc, ...cssDocs], started);
}

/** Validate direct input (HTML or CSS). */
export async function validateText(
  type: "html" | "css",
  text: string,
  fragment: boolean,
  options: ValidationOptions,
): Promise<RunResult> {
  const started = performance.now();
  const doc = await validateDocument({
    id: "direct",
    label: "Direct input",
    kind: type,
    origin: "direct",
    options,
    text,
    fragment: type === "html" && fragment,
  });
  return finalizeRun({ type, target: "Direct input", fragment: type === "html" && fragment }, [doc], started);
}

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
  kind: DocumentKind;
}

/** Validate uploaded files (already checked for extension, MIME, size and content). */
export async function validateUploads(files: UploadedFile[], options: ValidationOptions): Promise<RunResult> {
  const started = performance.now();
  const docs = await mapLimit(files, 3, (file, i) =>
    validateDocument({ id: `file-${i + 1}`, label: file.name, kind: file.kind, origin: "upload", options, bytes: file.bytes }),
  );
  return finalizeRun({ type: "upload", target: files.map((f) => f.name).join(", ") }, docs, started);
}
