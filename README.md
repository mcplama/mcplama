<h1><img src="ui/public/icons/mcplama-icon-64.png" width="36" align="center" alt="MCPlama icon"> MCPlama</h1>

Open-source MCP gateway for connecting AI clients to governed, self-hosted
tools. MCPlama centralizes connection credentials, access policy, audit events,
and MCP server lifecycle without requiring every client to understand those
concerns.

## Architecture at a glance

[![Detailed MCPlama architecture showing clients, gateway request checks, PostgreSQL, remote MCP servers, broker, Docker runtime, and isolated runner containers.](docs/static/img/mcplama-architecture-detailed.svg)](docs/static/img/mcplama-architecture-detailed.svg)

The gateway does not talk to Docker directly. The broker is the only component
with Docker socket access in the recommended multi-container deployment, and
the runner image never receives that socket. This boundary is documented in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and recorded as
[`ADR-0001`](adr/0001-process-boundary-and-broker.md).

## Screenshots

### Admin dashboard

![MCPlama admin dashboard with gateway activity, server status, and quick actions.](docs/static/img/mcplama-dash.png)

### Member portal

![MCPlama member portal showing available MCP servers and connection status.](docs/static/img/mcplama-member-redacted.png)

## Documentation

- [Overview](docs/README.md) — architecture, stack, repo layout
- [Architecture](docs/ARCHITECTURE.md) — processes, request flow, the container broker
- [Security policy](docs/SECURITY.md) — how to report vulnerabilities
- [Security model](docs/SECURITY-MODEL.md) — trust boundaries + production checklist
- [Contributing](CONTRIBUTING.md) — development, review, and security rules
- [Contributor development](docs/DEVELOPMENT.md) — running the source with hot reload
- [Docker image](docs/DOCKER.md) — using the published image and releasing images
- [Registry requests](docs/REGISTRY.md) — request or contribute an MCP catalog entry
- [API reference](docs/API.md) — REST API, auth, and the OpenAPI spec
- [Changelog](CHANGELOG.md) — what changed and why
- [Design workflow](docs/DESIGN.md) — proposals and architecture decisions

## Repository map

| Directory | Responsibility |
|---|---|
| `server/app/api` | HTTP endpoints, authentication, OAuth, and MCP connection routes |
| `server/app/services` | Policy, registry, credentials, runtime, and proxy orchestration |
| `server/app/models` | Database entities and durable state |
| `server/app/broker` | Typed container lifecycle boundary; the only Docker-aware process |
| `server/alembic` | Versioned PostgreSQL schema migrations |
| `ui/src` | React operator dashboard and connection flows |
| `registry` | Curated MCP server metadata and catalog index |
| `deploy` | Bundled-image and LAN reverse-proxy/process configuration |
| `docs` and `adr` | Architecture, security, operations, and durable design decisions |

## Quick start (run the published image)

If you want to use MCPlama, pull the published image. You do not need to clone
the repository or build the application locally.

```bash
# The image contains the UI, API, broker, registry, Nginx, and PostgreSQL.
docker pull mcplama/mcplama:latest
docker network inspect mcplama >/dev/null 2>&1 || docker network create mcplama
docker run -d --name mcplama \
  -p 8080:8080 \
  -v mcplama-data:/var/lib/postgresql \
  -v /var/run/docker.sock:/var/run/docker.sock \
  mcplama/mcplama:latest
```

Open http://localhost:8080 and go through the setup wizard to create your admin
account. For production, provide secrets and put an HTTPS reverse proxy in
front of the image; see [Docker image](docs/DOCKER.md).

If you want to change MCPlama, start with the
[contributor development workflow](docs/DEVELOPMENT.md) instead of this
deployment command.

Prefer to skip the wizard? Seed one directly (there's no default account):

```bash
docker exec -e SEED_ADMIN_EMAIL=me@example.com -e SEED_ADMIN_PASSWORD=changeme mcplama \
  python -m app.db.seed
```

## How it works

```
AI Client (Claude Desktop, Cursor)
  └── mcp-remote → http://localhost:8000/connect/{token}
        └── MCPlama gateway
              ├── resolves connection token → user + server
              ├── validates Origin (DNS-rebinding guard)
              ├── checks access policies      (fails closed)
              ├── injects OAuth/API token     (never sent to the client)
              ├── writes audit log
              └── proxies to real MCP server
```

MCP server containers are started by a separate **broker** process — the only
component that can talk to the Docker socket. The gateway itself has no Docker
access, so compromising it cannot escalate to the host. See
[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

## Adding a server

1. Go to **Catalog** — browse 10+ pre-configured connectors
2. Click **Install** — server added, ready to authorize
3. Click the server → **Authorization tab** — follow setup steps, paste credentials, click Authorize
4. Go to **Connect tab** — create a connection token
5. Copy the Claude Desktop config snippet — paste into `claude_desktop_config.json`

![Animated walkthrough of adding an MCP server to MCPlama](docs/static/img/overview.gif)

## Connection URL

```
http://localhost:8000/connect/{token}
```

Each user × server pair gets a unique token. No API keys in client config.

## Connecting your AI client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "notion": {
      "url": "http://localhost:8000/connect/mcp_your_token"
    }
  }
}
```

Restart Claude Desktop. The server tools appear in the tools menu.

### Claude Code (CLI)

```bash
claude mcp add --transport http notion http://localhost:8000/connect/mcp_your_token
```

Verify with `claude mcp list`. To scope it to the current project only, add `--scope project`.

### VS Code (GitHub Copilot)

Requires VS Code 1.99+ with GitHub Copilot. Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "notion": {
      "url": "http://localhost:8000/connect/mcp_your_token"
    }
  }
}
```

Open Copilot Chat in Agent mode (`Ctrl+Shift+I` / `⌘+Shift+I`) — the tools are available automatically.

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "notion": {
      "url": "http://localhost:8000/connect/mcp_your_token"
    }
  }
}
```

## Environment variables

```env
DATABASE_URL=postgresql+asyncpg://mcplama:change-me@postgres:5432/mcplama
SECRET_KEY=change-me-in-production
TOKEN_ENCRYPTION_KEY=32-byte-key-for-aes-encryption!!
GATEWAY_URL=http://localhost:8000
REGISTRY_URL=http://localhost:8000/api/v1/registry
CORS_ORIGINS=http://localhost:5173
```

## License

MCPlama is licensed under the GNU Affero General Public License, version 3 or
any later version. See [LICENSE](LICENSE).

Third-party dependencies remain under their respective licenses. See
[THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES) for dependency notices.
