# MarkupLens

A local HTML/CSS validator with a modern UI and report generation. Validation itself is done by the
self-hosted [Nu Html Checker (vnu)](https://github.com/validator/validator), run in Docker. MarkupLens
never calls the public W3C services.

The full specification lives in [docs/SPEC.md](docs/SPEC.md).

> **Status:** Phase 2 (validation core) in progress.

## Requirements

- Node.js 22 LTS (see `.nvmrc`; `package.json` declares `"engines": { "node": ">=22" }`)
- npm
- Docker Desktop with Docker Compose v2

## Configuration

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
|---|---|---|
| `VNU_IMAGE` | `ghcr.io/validator/validator@sha256:0811ae47…556e616` | Pinned vnu image (see [vnu version pin](#vnu-version-pin)) |
| `VNU_URL` | `http://localhost:8888` | Where the app reaches vnu (Compose overrides this to `http://vnu:8888`) |
| `VNU_TIMEOUT_MS` | `30000` | Timeout for vnu calls |
| `ALLOW_PRIVATE_URLS` | `true` | Allow validating localhost/LAN/VPN URLs. A notice is shown in the footer while it is on |
| `APP_PORT` | `3000` | Host port for the app container (bound to `127.0.0.1` only) |

## vnu version pin

vnu is pinned by **image digest** so validation results never change underneath you:

```
ghcr.io/validator/validator@sha256:0811ae47955ff59e52862df4b4d0cba90cd6fdaa62eefc2806aecb883556e616
```

- **Pinned on:** 2026-10-09. This is the digest `ghcr.io/validator/validator:latest` pointed to on that
  date (image built 2026-10-07). The project publishes no newer numbered image tags than `24.10.17`.
- **Fallback:** if the digest stops working, set `VNU_IMAGE=ghcr.io/validator/validator:24.10.17` in `.env`
  (the newest numbered tag).
- **To update:** resolve the current digest of `:latest`, update `VNU_IMAGE` in `.env.example` and the
  default in `docker-compose.yml`, re-run the fixture tests, and update the date above.

## Option A: local development (recommended while coding)

Run only vnu in Docker and the app with `npm run dev`:

```bash
npm install
docker compose up -d vnu
npm run dev
```

Open http://localhost:3000. The "Validation engine" card should show **Online**.

## Option B: full stack in Docker

```bash
docker compose up --build
```

Open http://localhost:3000. Both containers publish ports on `127.0.0.1` only, so nothing is reachable
from your network.

When the app runs inside Docker, `localhost` and `127.0.0.1` in URLs you validate are rewritten to
`host.docker.internal`, so sites served by XAMPP on your machine can still be checked.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Vitest unit tests |
| `npm run vnu:up` / `npm run vnu:down` | Start / stop only the vnu container |

## Health check

`GET /api/health` posts a tiny HTML document to vnu and returns `200` with `status: "ok"` when vnu
validates it, or `503` with `status: "degraded"` and an error message otherwise.

## Phase 7 hardening backlog

Items deliberately parked until Phase 7 (`chore/hardening`):

- **npm audit: 9 high-severity findings, dev-only.** All come from an outdated `braces` package
  (stack-exhaustion DoS, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)),
  reached through `micromatch` → `fast-glob` in development tooling only:
  - `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`
  - the shadcn CLI (`shadcn`, `@shadcn/registry`, `ts-morph` / `@ts-morph/common`) → `fast-glob` → `micromatch` → `braces`

  The 9 flagged packages: `braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`,
  `eslint-config-next`, `shadcn`, `@shadcn/registry`, `ts-morph`, `@ts-morph/common`.

  None of these run in the app at runtime. `npm audit fix --force` is **not** used because it would
  install breaking major versions; revisit when upstream releases fixed versions.
