#!/usr/bin/env node
/**
 * Fixture website for the e2e tests (http://127.0.0.1:3199). Nothing leaves
 * the machine: MarkupLens (ALLOW_PRIVATE_URLS=true) validates these pages.
 *
 *   /bad.html             known errors + a linked stylesheet with a CSS error
 *   /style.css            CSS with errors
 *   /xss.html             markup that would run script if it were ever rendered as HTML
 *   /page/<n>             small pages for bulk runs (1 error each)
 *   /slow/<n>             like /page/<n>, answered after 4 s (bulk cancel)
 *   /sitemap.xml          lists /page/1 … /page/6
 *   /mutable/<key>        version "a" (3 errors) or "b" (2 fixed, 1 new) of a page
 *   /__mutable/<key>/<v>  switch <key> to version a or b (each test uses its own key)
 */
import { createServer } from "node:http";

const PORT = Number(process.env.E2E_SITE_PORT || 3199);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const page = (title, body, head = "") =>
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${head}
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

const BAD = page(
  "E2E fixture with errors",
  `<h1>Fixture page</h1>
<h3>Skipped heading level</h3>
<img src="photo.png">
<p id="dup">one</p>
<p id="dup">two</p>
<center>obsolete</center>
<div><span>unclosed</div>`,
  `<link rel="stylesheet" href="/style.css">`,
);

const CSS = `body { colr: red; }
.box { margin: 10px 5; }
`;

const XSS = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>&lt;script&gt;window.__xss=1&lt;/script&gt; injection probe</title>
</head>
<body>
<main>
<h1><img src="x" onerror="window.__xss=2">Probe <script>window.__xss=3</script></h1>
<h3><svg onload="window.__xss=4"></svg>Skipped</h3>
<img src="x" alt="&quot;&gt;&lt;img src=x onerror=window.__xss=5&gt;">
<p id="&lt;svg onload=window.__xss=6&gt;">id</p>
<foo onclick="window.__xss=7"><script>alert(8)</script></foo>
<a href="javascript:window.__xss=9">link</a>
<iframe srcdoc="<script>parent.__xss=10</script>"></iframe>
</main>
</body>
</html>
`;

const numbered = (n) => page(`Bulk page ${n}`, `<h1>Page ${n}</h1>\n<img src="p${n}.png">\n<p>Content for page ${n}.</p>`);

const MUTABLE = {
  a: page(
    "Mutable page before the fix",
    `<h1>Mutable</h1>
<img src="a.png">
<center>old</center>
<p id="same">x</p><p id="same">y</p>`,
  ),
  b: page(
    "Mutable page after the fix",
    `<h1>Mutable</h1>
<img src="a.png" alt="Fixed">
<p id="same">x</p><p id="same">y</p>
<font>new problem</font>`,
  ),
};
const mutableState = new Map();

function sitemap() {
  const urls = Array.from({ length: 6 }, (_, i) => `  <url><loc>${ORIGIN}/page/${i + 1}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  const send = (status, type, body) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  const html = (body) => send(200, "text/html; charset=utf-8", body);
  const p = url.pathname;
  let m;

  if (p === "/" || p === "/index.html") return html(page("E2E fixture site", `<h1>Fixture site</h1>\n<p><a href="/bad.html">bad</a></p>`));
  if (p === "/bad.html") return html(BAD);
  if (p === "/style.css") return send(200, "text/css; charset=utf-8", CSS);
  if (p === "/xss.html") return html(XSS);
  if (p === "/sitemap.xml") return send(200, "application/xml; charset=utf-8", sitemap());
  if (p === "/robots.txt") return send(200, "text/plain", `Sitemap: ${ORIGIN}/sitemap.xml\n`);
  if ((m = /^\/page\/(\d+)$/.exec(p))) return html(numbered(m[1]));
  if ((m = /^\/slow\/(\d+)$/.exec(p))) {
    const timer = setTimeout(() => html(numbered(m[1])), 4000);
    res.on("close", () => clearTimeout(timer)); // client went away (e.g. a cancelled bulk run)
    return;
  }
  if ((m = /^\/__mutable\/([\w-]+)\/([ab])$/.exec(p))) {
    mutableState.set(m[1], m[2]);
    return send(200, "text/plain", `ok ${m[1]}=${m[2]}`);
  }
  if ((m = /^\/mutable\/([\w-]+)$/.exec(p))) return html(MUTABLE[mutableState.get(m[1]) ?? "a"]);
  if (p === "/health") return send(200, "text/plain", "ok");
  send(404, "text/html; charset=utf-8", page("Not found", "<h1>Not found</h1>"));
});

server.listen(PORT, "127.0.0.1", () => console.log(`E2E fixture site on ${ORIGIN}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
