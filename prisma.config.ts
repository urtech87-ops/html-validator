import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration. The database is DATA_DIR/markuplens.db, the same
 * file the app opens (src/lib/history/db.ts): ./data for `npm run dev`,
 * /app/data (the Docker volume) in the container.
 */
const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: `file:${path.join(dataDir, "markuplens.db")}` },
});
