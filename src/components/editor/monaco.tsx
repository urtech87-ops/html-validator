"use client";

/**
 * Monaco wrappers. This module is only ever loaded through next/dynamic
 * (ssr: false), so Monaco's ~3 MB stays out of the initial bundle. The editor
 * files are served by the app from /monaco/vs (see scripts/copy-monaco.mjs).
 */
import { useEffect, useRef } from "react";
import Editor, { loader, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { Severity } from "@/lib/validation/types";
import { EditorLoading } from "./monaco-loading";
import { useIsDark } from "./use-media-query";

loader.config({ paths: { vs: "/monaco/vs" } });

const COMMON_OPTIONS: MonacoEditor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  lineNumbersMinChars: 4,
  scrollBeyondLastLine: false,
  wordWrap: "off",
  automaticLayout: true,
  tabSize: 2,
  renderWhitespace: "selection",
  accessibilitySupport: "auto",
};

export interface MonacoInputProps {
  value: string;
  onChange: (value: string) => void;
  language: "html" | "css";
  height: number;
  ariaLabel: string;
  onSubmit?: () => void;
}

export function MonacoInput({ value, onChange, language, height, ariaLabel, onSubmit }: MonacoInputProps) {
  const dark = useIsDark();
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => submitRef.current?.());
  };

  return (
    <Editor
      value={value}
      onChange={(v) => onChange(v ?? "")}
      language={language}
      height={height}
      theme={dark ? "vs-dark" : "vs"}
      onMount={handleMount}
      options={{ ...COMMON_OPTIONS, ariaLabel }}
      loading={<EditorLoading height={height} />}
    />
  );
}

export interface SourceMarker {
  severity: Severity;
  message: string;
  firstLine: number;
  firstColumn?: number;
  lastLine: number;
  lastColumn?: number;
}

export interface MonacoSourceProps {
  value: string;
  language: "html" | "css" | "xml";
  height: number;
  markers: SourceMarker[];
  /** Change `nonce` to reveal the same line again. */
  reveal?: { line: number; nonce: number };
  onGutterClick?: (line: number) => void;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function MonacoSource({ value, language, height, markers, reveal, onGutterClick }: MonacoSourceProps) {
  const dark = useIsDark();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const clickRef = useRef(onGutterClick);
  useEffect(() => {
    clickRef.current = onGutterClick;
  }, [onGutterClick]);

  const applyMarkers = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;

    const toMonacoSeverity = (s: Severity) =>
      s === "error" ? monaco.MarkerSeverity.Error : s === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info;

    monaco.editor.setModelMarkers(
      model,
      "markuplens",
      markers.map((m) => ({
        severity: toMonacoSeverity(m.severity),
        message: m.message,
        startLineNumber: m.firstLine,
        startColumn: m.firstColumn ?? 1,
        endLineNumber: m.lastLine,
        endColumn: (m.lastColumn ?? model.getLineMaxColumn(Math.min(m.lastLine, model.getLineCount()))) + 1,
      })),
    );

    // One gutter glyph per line, showing the most severe message on it.
    const worst = new Map<number, Severity>();
    for (const m of markers) {
      const line = m.lastLine;
      const current = worst.get(line);
      if (!current || SEVERITY_ORDER[m.severity] < SEVERITY_ORDER[current]) worst.set(line, m.severity);
    }
    const decorations = [...worst].map(([line, severity]) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: `ml-line-${severity}`,
        glyphMarginClassName: `ml-glyph ml-glyph-${severity}`,
        glyphMarginHoverMessage: { value: "Show messages for this line" },
      },
    }));
    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection(decorations);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onMouseDown((e) => {
      const type = e.target.type;
      if (
        (type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) &&
        e.target.position
      ) {
        clickRef.current?.(e.target.position.lineNumber);
      }
    });
    applyMarkers();
    // Wait a frame so the editor has its final size, otherwise "center" is computed against 0 px.
    if (reveal) requestAnimationFrame(() => revealLine(editor, reveal.line));
  };

  useEffect(applyMarkers, [markers, value]);

  useEffect(() => {
    if (reveal && editorRef.current) revealLine(editorRef.current, reveal.line);
  }, [reveal]);

  return (
    <Editor
      value={value}
      language={language}
      height={height}
      theme={dark ? "vs-dark" : "vs"}
      onMount={handleMount}
      options={{
        ...COMMON_OPTIONS,
        readOnly: true,
        domReadOnly: true,
        glyphMargin: true,
        ariaLabel: "Validated source code (read-only)",
      }}
      loading={<EditorLoading height={height} />}
    />
  );
}

function revealLine(editor: MonacoEditor.IStandaloneCodeEditor, line: number) {
  editor.revealLineInCenter(line);
  editor.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 });
  editor.focus();
}
