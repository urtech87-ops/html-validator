#!/bin/sh
# MarkupLens container start: apply the committed database migrations with the
# official `prisma migrate deploy`, then start the Next.js server. If the
# migration fails the container stops with a clear message instead of
# starting an app whose history can't work.
set -u

DATA_DIR="${DATA_DIR:-/app/data}"
export DATA_DIR

echo "MarkupLens: applying database migrations to ${DATA_DIR}/markuplens.db"
if ! node /app/node_modules/prisma/build/index.js migrate deploy --config /app/prisma.config.ts; then
  echo "MarkupLens: ERROR - the database migration failed, so the app was not started." >&2
  echo "MarkupLens: check that ${DATA_DIR} is writable (the markuplens-data volume) and see the Prisma error above." >&2
  exit 1
fi

exec node /app/server.js
