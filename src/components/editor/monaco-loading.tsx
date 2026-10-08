/** Placeholder shown while the Monaco bundle loads (kept separate so it isn't lazy itself). */
export function EditorLoading({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center bg-muted/40 text-sm text-muted-foreground"
      style={{ height }}
      role="status"
    >
      Loading editor…
    </div>
  );
}
