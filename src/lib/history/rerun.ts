import "server-only";
import { validateText, validateUploads, validateUrl } from "@/lib/validation/run";
import { loadRerunInput, saveSingleRun } from "./store";

export class RerunError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Run a saved single run again with its original input and options; returns the new run's id. */
export async function rerunSingle(id: string): Promise<string> {
  const saved = await loadRerunInput(id);
  if (!saved) throw new RerunError("This run can't be re-run: it doesn't exist or its input wasn't kept (inputs over 10 MB aren't saved).", 404);
  const { input, options } = saved;
  if (input.type === "bulk") throw new RerunError("Bulk runs are re-run from the Bulk page (/bulk?rerun=<id>).", 400);
  let run;
  if (input.type === "url") run = await validateUrl(input.value, options);
  else if (input.type === "upload") {
    run = await validateUploads(
      input.files.map((f) => ({ name: f.name, kind: f.kind, bytes: new Uint8Array(Buffer.from(f.base64, "base64")) })),
      options,
    );
  } else run = await validateText(input.type, input.value, input.fragment, options);
  return saveSingleRun(run, options, input);
}
