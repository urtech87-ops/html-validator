import { trySaveSingleRun, wantsSave } from "@/lib/history/store";
import { MAX_SAVED_SOURCE_BYTES, type RerunInput } from "@/lib/history/types";
import { localOnly } from "@/lib/http/local-only";
import { parseOptions } from "@/lib/validation/options";
import { validateUploads, type UploadedFile } from "@/lib/validation/run";
import { checkUpload, MAX_UPLOAD_FILES } from "@/lib/validation/upload";

/**
 * POST /api/validate/upload  (multipart/form-data)
 * Fields: files (one or more), options (JSON string, optional), save ("false" to skip history).
 * Returns a normalised RunResult with one document per file, plus `runId` when saved.
 */
export const POST = localOnly(async (request: Request) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data with one or more “files”." }, { status: 400 });
  }

  let options;
  try {
    options = parseOptions(JSON.parse(String(form.get("options") ?? "{}")));
  } catch {
    return Response.json({ error: "“options” must be a JSON string." }, { status: 400 });
  }

  const entries = form.getAll("files").filter((f): f is File => f instanceof File);
  if (entries.length === 0) return Response.json({ error: "No files were uploaded." }, { status: 400 });
  if (entries.length > MAX_UPLOAD_FILES) {
    return Response.json({ error: `Too many files: at most ${MAX_UPLOAD_FILES} per run.` }, { status: 400 });
  }

  const files: UploadedFile[] = [];
  const errors: string[] = [];
  for (const file of entries) {
    const precheck = checkUpload(file.name, file.type, file.size);
    if (!precheck.ok) {
      errors.push(precheck.error);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkUpload(file.name, file.type, bytes.byteLength, bytes);
    if (!check.ok) errors.push(check.error);
    else files.push({ name: file.name, bytes, kind: check.kind });
  }

  if (errors.length > 0) return Response.json({ error: errors.join(" ") , errors }, { status: 400 });
  const run = await validateUploads(files, options);
  if (!wantsSave(form.get("save"))) return Response.json(run);
  // The files are kept for re-runs when they fit in the saved-input limit.
  const total = files.reduce((n, f) => n + f.bytes.byteLength, 0);
  const rerun: RerunInput | null =
    total <= MAX_SAVED_SOURCE_BYTES ? { type: "upload", files: files.map((f) => ({ name: f.name, kind: f.kind, base64: Buffer.from(f.bytes).toString("base64") })) } : null;
  return Response.json({ ...run, ...(await trySaveSingleRun(run, options, rerun)) });
});
