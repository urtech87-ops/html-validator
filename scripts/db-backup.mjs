#!/usr/bin/env node
/**
 * npm run db:backup — copy the history database and the saved report files
 * into backups/<timestamp>/ (git- and docker-ignored).
 *
 * The database is copied with SQLite's online backup API, so it is consistent
 * even while the app is running (WAL mode). DATA_DIR defaults to ./data, as for
 * `npm run dev`. For the Docker volume see "Backing up history" in the README.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const dbFile = path.join(dataDir, "markuplens.db");
if (!existsSync(dbFile)) {
  console.error(`db:backup: no history database at ${dbFile} (set DATA_DIR if it lives elsewhere).`);
  process.exit(1);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
// Local time, e.g. 2026-10-10_16-05-30.
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
const target = path.resolve("backups", stamp);
mkdirSync(target, { recursive: true });

const db = new Database(dbFile, { readonly: true, fileMustExist: true });
try {
  await db.backup(path.join(target, "markuplens.db"));
} finally {
  db.close();
}

const reports = path.join(dataDir, "reports");
let files = 0;
if (existsSync(reports)) {
  cpSync(reports, path.join(target, "reports"), { recursive: true });
  const count = (dir) => readdirSync(dir).reduce((n, name) => n + (statSync(path.join(dir, name)).isDirectory() ? count(path.join(dir, name)) : 1), 0);
  files = count(path.join(target, "reports"));
}

const mb = (statSync(path.join(target, "markuplens.db")).size / 1024 / 1024).toFixed(1);
console.log(`db:backup: ${dbFile} (${mb} MB) and ${files} saved report file(s) -> ${target}`);
