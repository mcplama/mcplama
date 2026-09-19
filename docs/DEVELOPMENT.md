# Local development

This guide is for contributors changing MCPlama. Production users should pull
`mcplama/mcplama:latest` as described in [DOCKER.md](DOCKER.md). Contributors
use `docker-compose.dev.yml` for the server, broker, and PostgreSQL, while the
UI runs natively with Vite for fast reloads.

## Prerequisites

- Docker
- Docker Compose
- Node.js 20.19+ (or 22.12+) and npm

## Start the contributor stack

Copy `.env.example` to `.env` and fill in the required values. Then run:

```bash
docker compose -f docker-compose.dev.yml up postgres broker server
```

Docker Compose creates the `mcplama-dev` network declared in the compose file;
there is no separate network setup step for local development.

The server is available at `http://localhost:8000`. The broker is internal-only
and is the only development service with Docker socket access.

## Start the UI

```bash
cd ui
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies API, MCP, OAuth, and discovery
requests to the server.

## First run

Open the UI and use the Setup wizard to create the first administrator. There
is no default account. For a disposable local account:

```bash
docker compose -f docker-compose.dev.yml exec server \
  sh -c 'SEED_ADMIN_EMAIL=me@example.com SEED_ADMIN_PASSWORD=changeme python -m app.db.seed'
```

## Frontend commands

```bash
npm run build      # production UI build in ui/dist/
npm run preview    # preview the production build
```

## Database migrations

Alembic migrations live in `server/alembic/versions/` and are applied during
application startup. To create a migration:

```bash
docker compose -f docker-compose.dev.yml exec server \
  alembic revision --autogenerate -m "describe the change"
docker compose -f docker-compose.dev.yml exec server alembic upgrade head
```

## Runner image

`server/Dockerfile.runner` builds the wrapper image for stdio-based MCP servers.
It intentionally has no Docker socket. Build it with:

```bash
docker build -f server/Dockerfile.runner -t mcplama/runner:latest server
```

The broker starts MCP workloads; the runner only bridges stdio to the broker's
relay.
