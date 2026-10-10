import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Defence in depth for every response: no framing (clickjacking), no MIME
  // sniffing, and no Referer to the sites linked from results.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  // Report generators and the SQLite driver load from node_modules at runtime
  // (playwright-core and better-sqlite3 are external by default; listed for clarity).
  serverExternalPackages: ["exceljs", "playwright-core", "better-sqlite3", "@prisma/adapter-better-sqlite3", "undici"],
  // playwright-core reads browsers.json etc. dynamically, which file tracing can't see.
  outputFileTracingIncludes: {
    "/api/report": ["./node_modules/playwright-core/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
