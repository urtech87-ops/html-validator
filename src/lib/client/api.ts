"use client";

import type { ValidationOptions } from "@/lib/validation/options";
import type { RunResult } from "@/lib/validation/types";

async function parse(res: Response): Promise<RunResult> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`The server returned an unexpected response (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const message = (body as { error?: string })?.error;
    throw new Error(message || `Validation failed (HTTP ${res.status}).`);
  }
  return body as RunResult;
}

export async function validateUrlRequest(url: string, options: ValidationOptions, signal?: AbortSignal) {
  const res = await fetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "url", value: url, options }),
    signal,
  });
  return parse(res);
}

export async function validateTextRequest(
  type: "html" | "css",
  value: string,
  fragment: boolean,
  options: ValidationOptions,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, value, fragment, options }),
    signal,
  });
  return parse(res);
}

export async function validateFilesRequest(files: File[], options: ValidationOptions, signal?: AbortSignal) {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  form.append("options", JSON.stringify(options));
  const res = await fetch("/api/validate/upload", { method: "POST", body: form, signal });
  return parse(res);
}
