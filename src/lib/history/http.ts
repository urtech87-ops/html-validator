import "server-only";

/** JSON error for history routes; a database that isn't migrated yet gets a clear 503. */
export function historyError(err: unknown, what: string): Response {
  const text = err instanceof Error ? err.message : String(err);
  if (/no such table|SQLITE_CANTOPEN|unable to open database/i.test(text)) {
    console.error(`${what}: history database unavailable:`, err);
    return Response.json(
      { error: "The history database isn't available. Run `npm run db:migrate` (Docker runs migrations on start), then try again." },
      { status: 503 },
    );
  }
  console.error(`${what} failed:`, err);
  return Response.json({ error: `${what} failed.` }, { status: 500 });
}

export const NO_STORE = { "Cache-Control": "no-store" };
