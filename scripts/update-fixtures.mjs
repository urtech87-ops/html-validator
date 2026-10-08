// Regenerates tests/fixtures/*.expected.json from the PINNED local vnu.
// Run only after deliberately changing VNU_IMAGE:  npm run fixtures:update
// Never calls validator.w3.org.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const vnuUrl = (process.env.VNU_URL || "http://localhost:8888").replace(/\/+$/, "");
const dir = path.resolve("tests", "fixtures");

for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const body = readFileSync(path.join(dir, file));
  const res = await fetch(`${vnuUrl}/?out=json`, { method: "POST", headers: { "Content-Type": "text/html" }, body });
  if (!res.ok) throw new Error(`vnu returned HTTP ${res.status} for ${file}`);
  const json = await res.json();
  const messages = json.messages.map(({ type, subType, message, firstLine, lastLine, firstColumn, lastColumn }) => ({
    type,
    subType,
    message,
    firstLine,
    lastLine,
    firstColumn,
    lastColumn,
  }));
  const out = { vnuVersion: json.version, generatedAt: new Date().toISOString().slice(0, 10), messages };
  writeFileSync(path.join(dir, file.replace(/\.html$/, ".expected.json")), JSON.stringify(out, null, 2) + "\n");
  console.log(`${file}: ${messages.length} messages (vnu ${json.version})`);
}
