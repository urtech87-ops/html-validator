"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function utc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * A date in the viewer's time zone. The server (often UTC in Docker) renders
 * UTC; the browser switches to local time after hydration.
 */
export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(iso);
  const text = !mounted
    ? dateOnly
      ? iso.slice(0, 10)
      : utc(iso)
    : dateOnly
      ? date.toLocaleDateString(undefined, { dateStyle: "medium" })
      : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={iso} title={date.toISOString()}>
      {text}
    </time>
  );
}
