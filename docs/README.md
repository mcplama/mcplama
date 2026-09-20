# MCPlama Documentation

MCPlama is an MCP (Model Context Protocol) gateway: a self-hosted control plane that sits between AI clients (Claude Desktop, Cursor, VS Code Copilot, etc.) and real MCP servers. It resolves per-user connection tokens, enforces access policies, injects OAuth/API credentials, writes audit logs, and proxies the actual tool calls.

```
AI Client (Claude Desktop, Cursor)
  └── mcp-remote → http://localhost:8000/connect/{token}
        └── MCPlama gateway
              ├── resolves connection token → user + server
              ├── checks access policies
              ├── injects OAuth/API token
              ├── writes audit log
              └── proxies to real MCP server
```

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI (Python 3.12) + SQLAlchemy 2.0 (async) + asyncpg |
| Frontend | React 18 + Vite + Tailwind |
| Database | PostgreSQL 16 |
| Server runtime | Docker — each installed MCP server runs in its own container, started by the **broker** (the only component with Docker socket access) |
| Reverse proxy (bundled build) | Nginx |
| Process supervision (bundled build) | supervisord |

## Where to go next

- **[Architecture](ARCHITECTURE.md)** — processes, request flow, the container broker, and where state lives.
- **[Security policy](SECURITY.md)** — how to report vulnerabilities.
- **[Security model](SECURITY-MODEL.md)** — trust boundaries, what's enforced, and the production checklist. **Read this before deploying.**
- **[Contributor development](DEVELOPMENT.md)** — run the source with server + UI hot reload.
- **[Install and run with Docker](DOCKER.md)** — installation options, recommended host specifications, persistent data, and MCP container resources.
- **[Registry requests](REGISTRY.md)** — request or contribute an MCP server catalog entry.
- **[API reference](API.md)** — REST API, auth model, and the auto-generated OpenAPI spec.
- **[Changelog](../CHANGELOG.md)** — what changed and why.

## Run MCPlama

Use the [Docker installation guide](DOCKER.md) for setup instructions,
including local-only and HTTPS reverse-proxy deployments. It also covers
recommended host specifications and persistent data. For contributors, see
[DEVELOPMENT.md](DEVELOPMENT.md).

## Repository layout

```
server/             FastAPI app (app/), the container broker (app/broker/), Alembic migrations,
                    requirements.txt, contributor Dockerfile.dev, Dockerfile.runner
ui/                 React/Vite app
deploy/             nginx.conf, supervisord.conf, entrypoint.sh — used by the public bundled image
docker-compose.dev.yml  Optional contributor stack with hot reload
Dockerfile           Public multi-stage image that bundles UI + server + nginx + Postgres
registry/           Local MCP server catalog metadata
```
