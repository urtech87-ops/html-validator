"use client";

import { useId, useRef, useState } from "react";
import { FileCode2, FileUp, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ACCEPTED_EXTENSIONS, extensionKind, MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "@/lib/validation/upload";
import { formatBytes } from "@/lib/format";
import { SubmitButton } from "./submit-button";

export function UploadForm({ busy, onSubmit }: { busy: boolean; onSubmit: (files: File[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const addFiles = (incoming: FileList | File[]) => {
    const next = [...files];
    const issues: string[] = [];
    for (const file of Array.from(incoming)) {
      if (!extensionKind(file.name)) issues.push(`“${file.name}” isn't an HTML, XHTML, CSS or SVG file.`);
      else if (file.size > MAX_UPLOAD_BYTES) issues.push(`“${file.name}” is larger than 5 MB.`);
      else if (file.size === 0) issues.push(`“${file.name}” is empty.`);
      else if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      else if (next.length >= MAX_UPLOAD_FILES) issues.push(`At most ${MAX_UPLOAD_FILES} files per run; “${file.name}” was skipped.`);
      else next.push(file);
    }
    setFiles(next);
    setProblems(issues);
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (files.length) onSubmit(files);
      }}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <FileUp className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">
          Drag files here, or{" "}
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => inputRef.current?.click()}>
            choose files
          </Button>
        </p>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {ACCEPTED_EXTENSIONS.join(", ")} · up to 5 MB each · up to {MAX_UPLOAD_FILES} files
        </p>
        <input
          ref={inputRef}
          id={id}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="sr-only"
          aria-label="Choose files to validate"
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {problems.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {files.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label="Selected files">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFiles(files.filter((f) => f !== file))}
                aria-label={`Remove ${file.name}`}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <SubmitButton busy={busy} disabled={files.length === 0} label={files.length > 1 ? `Validate ${files.length} files` : "Validate"} />
      </div>
    </form>
  );
}
