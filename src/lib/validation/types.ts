/**
 * Normalised validation result types, shared by the server (API) and the
 * client (results UI). Client-safe: no Node imports.
 */

export type Severity = "error" | "warning" | "info";

/** What a message is about: markup, CSS, or the document as a whole (encoding, I/O, limits). */
export type MessageCategory = "html" | "css" | "document";

export type DocumentKind = "html" | "xhtml" | "css" | "svg";

export type DocumentOrigin = "url" | "stylesheet" | "upload" | "direct";

export interface ValidationMessage {
  /** Stable within a run: `<documentId>:<index>`. */
  id: string;
  severity: Severity;
  category: MessageCategory;
  message: string;
  /** Who produced the message. vnu for nearly everything; "markuplens" for supplementary checks. */
  source: "vnu" | "markuplens";
  /** Raw vnu `type` / `subType`, kept for reports and debugging. */
  vnuType?: string;
  vnuSubType?: string;
  firstLine?: number;
  firstColumn?: number;
  lastLine?: number;
  lastColumn?: number;
  extract?: string;
  hiliteStart?: number;
  hiliteLength?: number;
}

export interface MessageCounts {
  errors: number;
  warnings: number;
  info: number;
}

export type EncodingSource = "bom" | "http-header" | "meta" | "css-charset" | "override" | "direct-input" | "fallback";

export interface EncodingInfo {
  /** Encoding used to decode the document for display, e.g. "utf-8". */
  name: string;
  source: EncodingSource;
  /** Encoding the document itself declared (header, BOM, meta, @charset), if any. */
  declared?: string;
}

export interface DoctypeInfo {
  kind: "html5" | "legacy" | "missing" | "not-applicable";
  /** Human label, e.g. "HTML5", "HTML 4.01 Strict". */
  label: string;
  /** The raw doctype text when present. */
  raw?: string;
}

export interface DocumentResult {
  id: string;
  /** URL, file name, or "Direct input". */
  label: string;
  kind: DocumentKind;
  origin: DocumentOrigin;
  /** Final URL after redirects (URL and stylesheet documents). */
  url?: string;
  /** Decoded source text, shown as code only (never injected as HTML). */
  source: string;
  sizeBytes: number;
  encoding: EncodingInfo;
  doctype: DoctypeInfo;
  httpStatus?: number;
  contentType?: string;
  fetchMs?: number;
  validateMs?: number;
  /** Number of inline <style> blocks (validated by vnu as part of the HTML pass). */
  inlineStyleBlocks?: number;
  /** Notices about the document that are not validation messages (e.g. "legacy doctype"). */
  notices: string[];
  /** Set when the document could not be validated at all (fetch failed, HTTP 404, too large…). */
  fatal?: string;
  messages: ValidationMessage[];
  counts: MessageCounts;
  score: number;
  passed: boolean;
}

export interface RunInput {
  type: "url" | "html" | "css" | "upload";
  /** URL, "Direct input", or a list of uploaded file names. */
  target: string;
  /** Direct input only: was the input treated as a fragment? */
  fragment?: boolean;
}

export interface RunResult {
  id: string;
  createdAt: string;
  input: RunInput;
  documents: DocumentResult[];
  counts: MessageCounts;
  score: number;
  passed: boolean;
  engineVersion?: string;
  durationMs: number;
}
