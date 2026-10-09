// Copies Monaco's prebuilt AMD bundle into public/monaco/vs so the editor is
// served by the app itself (no CDN). Runs before `next dev` and `next build`.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// npm runs scripts from the package root.
const pkgPath = path.resolve("node_modules", "monaco-editor", "package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
const src = path.join(path.dirname(pkgPath), "min", "vs");
const dest = path.resolve("public", "monaco", "vs");
const stamp = path.resolve("public", "monaco", "VERSION");

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) {
  console.log(`monaco-editor ${version} already in public/monaco`);
} else {
  rmSync(path.resolve("public", "monaco"), { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  writeFileSync(stamp, version);
  console.log(`copied monaco-editor ${version} to public/monaco/vs`);
}
