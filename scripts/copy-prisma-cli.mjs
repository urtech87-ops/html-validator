#!/usr/bin/env node
/**
 * Copy the Prisma CLI and everything it depends on (as installed from
 * package-lock.json) into another node_modules folder, keeping the nested
 * layout so Node resolves the same versions. The Docker image uses this to
 * run the official `prisma migrate deploy` next to the standalone server
 * without shipping the whole node_modules.
 *
 *   node scripts/copy-prisma-cli.mjs <from node_modules> <to node_modules>
 */
import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const [from, to] = process.argv.slice(2).map((p) => path.resolve(p));
if (!from || !to) {
  console.error("usage: node scripts/copy-prisma-cli.mjs <from node_modules> <to node_modules>");
  process.exit(2);
}

/** Node's lookup: <dir>/node_modules/<name>, then each parent's node_modules, up to the root. */
function resolvePackage(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.resolve(dir) === path.dirname(from)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const top = path.join(from, name);
  return existsSync(path.join(top, "package.json")) ? top : undefined;
}

const seen = new Set();
const queue = [path.join(from, "prisma")];
let count = 0;
while (queue.length) {
  const dir = queue.shift();
  if (seen.has(dir)) continue;
  seen.add(dir);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  cpSync(dir, path.join(to, path.relative(from, dir)), { recursive: true, dereference: true });
  count++;
  for (const [name, optional] of [
    ...Object.keys(pkg.dependencies ?? {}).map((n) => [n, false]),
    ...Object.keys(pkg.optionalDependencies ?? {}).map((n) => [n, true]),
  ]) {
    const dep = resolvePackage(name, dir);
    if (dep) queue.push(dep);
    else if (!optional) {
      console.error(`copy-prisma-cli: ${pkg.name} needs ${name}, which is not installed`);
      process.exit(1);
    }
  }
}
console.log(`copy-prisma-cli: copied ${count} packages to ${to}`);
