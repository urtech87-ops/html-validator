import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Report generators and the SQLite driver load from node_modules at runtime
  // (playwright-core and better-sqlite3 are external by default; listed for clarity).
  serverExternalPackages: ["exceljs", "playwright-core", "better-sqlite3", "@prisma/adapter-better-sqlite3"],
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
