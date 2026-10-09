// Render PDF pages to PNG with pdf.js (dev helper for checking reports).
// Usage: node scripts/pdf-to-png.mjs <file.pdf> <outPrefix> [pages=1] [scale=1.6]
//   pages: "1", "1,3" or "1-3". Writes <outPrefix>-p<N>.png next to the prefix.
import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [file, prefix, pagesArg = "1", scaleArg = "1.6"] = process.argv.slice(2);
if (!file || !prefix) {
  console.error("Usage: node scripts/pdf-to-png.mjs <file.pdf> <outPrefix> [pages] [scale]");
  process.exit(1);
}

const wanted = new Set();
for (const part of pagesArg.split(",")) {
  const [a, b] = part.split("-").map(Number);
  for (let p = a; p <= (b || a); p++) wanted.add(p);
}

const task = getDocument({ data: new Uint8Array(readFileSync(file)) });
const pdf = await task.promise;
for (const n of [...wanted].filter((p) => p >= 1 && p <= pdf.numPages)) {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale: Number(scaleArg) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const out = `${prefix}-p${n}.png`;
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(`${out} (${pdf.numPages} pages in total)`);
}
await task.destroy();
