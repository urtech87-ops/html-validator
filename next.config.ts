import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Report generators load from node_modules at runtime (playwright-core is external by default).
  serverExternalPackages: ["exceljs", "playwright-core"],
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
