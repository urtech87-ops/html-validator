# syntax=docker/dockerfile:1
# MarkupLens app image (Next.js standalone build). Debian-based so the
# Playwright Chromium headless shell can render PDF reports.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    RUNNING_IN_DOCKER=true \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Fonts for PDF reports. fonts-noto-core includes Noto Sans, Noto Sans Arabic
# and Noto Naskh Arabic (Arabic text renders as real glyphs, not boxes);
# DejaVu Sans Mono is the monospace font for source extracts.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-noto-core fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

# Chromium headless shell + its system libraries, at the exact version the
# locked playwright-core expects.
COPY --from=deps /app/node_modules/playwright-core /tmp/playwright-core
RUN node /tmp/playwright-core/cli.js install --with-deps --only-shell chromium \
 && rm -rf /tmp/playwright-core /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright

COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
