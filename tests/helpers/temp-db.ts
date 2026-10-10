import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { closeDb } from "@/lib/history/db";

/**
 * A throwaway DATA_DIR under test-results/ (on the project drive, not C:) with
 * the committed migrations applied by the real `prisma migrate deploy`.
 */
export interface TempDataDir {
  dir: string;
  cleanup: () => Promise<void>;
}

const ROOT = path.resolve(import.meta.dirname, "../..");

export function migrate(dir: string): void {
  execFileSync(process.execPath, [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}

let template: string | undefined;

/** Migrate once per test process, then copy the empty database for each test. */
function migratedTemplate(): string {
  if (template && existsSync(path.join(template, "markuplens.db"))) return template;
  template = path.join(ROOT, "test-results", `history-template-${process.pid}`);
  rmSync(template, { recursive: true, force: true });
  mkdirSync(template, { recursive: true });
  migrate(template);
  const dir = template;
  process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
  return template;
}

let seq = 0;
export async function useTempDataDir(name: string, env: Record<string, string> = {}): Promise<TempDataDir> {
  const dir = path.join(ROOT, "test-results", `history-${name}-${process.pid}-${Date.now()}-${seq++}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(migratedTemplate(), "markuplens.db"), path.join(dir, "markuplens.db"));
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries({ DATA_DIR: dir, ...env })) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return {
    dir,
    cleanup: async () => {
      await closeDb();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A Request as a browser on this machine would send it. */
export function localRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", "127.0.0.1:3000");
  return new Request(new URL(url, "http://127.0.0.1:3000"), { ...init, headers });
}

/** Route context with params, as Next.js passes it to dynamic route handlers. */
export function ctx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}
