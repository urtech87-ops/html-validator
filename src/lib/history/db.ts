import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";

/**
 * The history database: DATA_DIR/markuplens.db (SQLite in WAL mode), opened
 * once per process. The schema is created by `prisma migrate deploy` (run by
 * `npm run dev` and by the Docker entrypoint), never by the app itself.
 */

export const DB_FILE = "markuplens.db";

export function dbPath(dataDir = getConfig().dataDir): string {
  return path.join(/* turbopackIgnore: true */ dataDir, DB_FILE);
}

export function reportsDir(dataDir = getConfig().dataDir): string {
  return path.join(/* turbopackIgnore: true */ dataDir, "reports");
}

interface Handle {
  dataDir: string;
  client: PrismaClient;
  ready: Promise<void>;
}

const globalForDb = globalThis as unknown as { markuplensDb?: Handle };

async function prepare(client: PrismaClient): Promise<void> {
  // WAL lets the history page read while a bulk run writes; the setting is stored in the file.
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await client.$executeRawUnsafe("PRAGMA synchronous = NORMAL");
  await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  // A bulk run still marked "running" belongs to a process that has gone (crash, restart).
  await client.run.updateMany({ where: { status: "running" }, data: { status: "interrupted" } });
}

/** The Prisma client for the configured DATA_DIR (re-opened if DATA_DIR changes, e.g. in tests). */
export async function getDb(): Promise<PrismaClient> {
  const { dataDir } = getConfig();
  let handle = globalForDb.markuplensDb;
  if (!handle || handle.dataDir !== dataDir) {
    if (handle) void handle.client.$disconnect().catch(() => {});
    mkdirSync(reportsDir(dataDir), { recursive: true });
    const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath(dataDir)}`, timeout: 10_000 });
    const client = new PrismaClient({ adapter });
    handle = { dataDir, client, ready: prepare(client) };
    globalForDb.markuplensDb = handle;
  }
  try {
    await handle.ready;
  } catch (err) {
    // Don't cache a failed start (e.g. migrations not applied yet); try again next time.
    if (globalForDb.markuplensDb === handle) globalForDb.markuplensDb = undefined;
    void handle.client.$disconnect().catch(() => {});
    throw err;
  }
  return handle.client;
}

/** Close the connection (tests, backups). */
export async function closeDb(): Promise<void> {
  const handle = globalForDb.markuplensDb;
  globalForDb.markuplensDb = undefined;
  if (handle) await handle.client.$disconnect();
}
