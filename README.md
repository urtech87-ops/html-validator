# MarkupLens

A local HTML/CSS validator with a modern UI and report generation. Validation itself is done by the
self-hosted [Nu Html Checker (vnu)](https://github.com/validator/validator), run in Docker. MarkupLens
never calls the public W3C services.

The full specification lives in [docs/SPEC.md](docs/SPEC.md).

> **Status:** Phase 1 (foundation): layout, dark mode, and an engine health check. Validation UI arrives in Phase 2.

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
| `VNU_VERSION` | `24.10.17` | Pinned `ghcr.io/validator/validator` image tag |
| `VNU_URL` | `http://localhost:8888` | Where the app reaches vnu (Compose overrides this to `http://vnu:8888`) |
| `VNU_TIMEOUT_MS` | `30000` | Timeout for vnu calls |
| `ALLOW_PRIVATE_URLS` | `true` | Allow validating localhost/LAN/VPN URLs. A notice is shown in the footer while it is on |
| `APP_PORT` | `3000` | Host port for the app container (bound to `127.0.0.1` only) |

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
