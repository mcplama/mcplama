# Architecture

MCPlama is a proxy that sits between AI clients and real MCP servers. It is a
**transparent** proxy at the protocol layer: JSON-RPC messages are forwarded
unmodified, so `initialize`, protocol-version negotiation, and tool semantics are
negotiated between the client and the upstream server exactly as if MCPlama were
not there. Everything MCPlama adds — auth, policy, audit — happens in the layer
*around* the protocol.

## Processes

| Process | Job | Docker socket? |
|---|---|---|
| **backend** | The API, dashboard, OAuth, policy, audit, and the `/connect` proxy | **No** |
| **broker** | Starts and stops containers. Nothing else. | **Yes — the only one** |
| **runner** | Wraps a stdio MCP server as HTTP (supergateway) | **No** |
| **postgres** | State: users, servers, policies, tokens, audit log | — |

The backend is the process most exposed to untrusted input, so it deliberately
cannot reach the Docker daemon. See [SECURITY-MODEL.md](SECURITY-MODEL.md) for why that
matters and what it buys.

## Request flow

```
AI client (Claude Desktop, Cursor, VS Code)
  │
  │  POST /connect/{token}   ← the token IS the credential
  ▼
backend
  ├── resolve token        → user + server        (401 + RFC 9728 challenge if unknown)
  ├── validate Origin      → 403 if cross-origin  (DNS-rebinding guard)
  ├── check access grant   → members need an approved request
  ├── evaluate policies    → fails CLOSED; a denial is a JSON-RPC error, not a 403
  ├── inject credentials   → shared secret, per-user token, or upstream OAuth
  ├── write audit row      → proxy.call (this is also the rate-limit ledger)
  └── proxy ──────────────► MCP server
```

The MCP server is reached one of two ways:

* **remote** — a plain HTTP proxy to `server.url`, SSRF-screened on every request
  (DNS can resolve differently than it did at creation time).
* **container** — the broker starts it, and the backend proxies to it over the
  internal `mcplama` network.

## Running an MCP server

Three shapes, all normalised behind one `/connect/{token}` endpoint.

**HTTP image** (`runtime=docker`, `transport=http`) — the broker starts the image
directly; it already speaks HTTP. Requests are sent to `/mcp` by default, or to
`server.mcp_path` if the admin set one (some images mount their MCP endpoint
somewhere else, e.g. `/api/mcp`). npx/uvx servers always run through our
supergateway wrapper, which is always mounted at `/mcp` regardless of this
setting.

**stdio image** (`runtime=docker`, `transport=stdio`) — the image speaks stdio, so
something must bridge stdio↔HTTP. supergateway does that, but it needs a process
on the other end of a pipe.

```
backend ──► broker: "open an stdio session for mcp/fetch"
            broker allocates a TCP port and listens
backend ──► broker: "start the runner, tell supergateway to dial that port"

runner (supergateway) ──socat──► broker :10000 ──► docker run -i mcp/fetch
```

The broker owns the `docker run -i` process and relays its stdin/stdout over TCP.
The runner has no Docker access at all.

> Previously the runner held the Docker socket so supergateway could `docker run`
> the image itself — docker-in-docker. That meant every MCP image the gateway ran
> was one command away from root on the host. The relay exists to remove that.

**npx / uvx** (`runtime=npx|uvx`) — the runner runs the package directly under
supergateway. No Docker involved beyond starting the runner.

## The broker API

Small and closed on purpose. It expresses *what* to run, never *how*.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness + whether the daemon is reachable |
| `GET /docker/info` | Images and running containers (backs the admin debug view) |
| `POST /images/pull` | Pull an image |
| `GET /containers` | List MCPlama-labelled containers |
| `GET /containers/{name}` | Is it running? |
| `POST /containers` | Start one |
| `DELETE /containers/{name}` | Remove one |
| `POST /stdio-sessions` | Open a stdio relay, returns a TCP port |
| `DELETE /stdio-sessions/{port}` | Close it |

`POST /containers` takes `name`, `image`, `env`, `cmd`, `shell`, `labels`,
`cpu_limit`, `memory_limit` — and nothing else. Unknown fields are **rejected**,
not ignored. The `docker run` argv is assembled inside the broker from those
typed fields, so there is no input that becomes a flag. `cpu_limit`/
`memory_limit` are clamped against the broker's own ceiling before being turned
into `--cpus`/`--memory` — see [SECURITY-MODEL.md](SECURITY-MODEL.md).
Authentication is a shared `BROKER_TOKEN` header; the broker is not published
to the host.

## State

Almost everything lives in Postgres. Two things are deliberately in memory:

| State | Where | Why |
|---|---|---|
| Users, servers, policies, connections, audit | Postgres | Durable |
| Encrypted credentials (AES-GCM) | Postgres | Durable, and must survive restart |
| Rate-limit counters | Postgres (`audit_logs`) | A control — must not reset on restart |
| Upstream OAuth client registration | Postgres (`servers`) | Refresh tokens are bound to it |
| MCP session IDs | Memory | Ephemeral; stale sessions are detected and retried |
| OAuth authorization codes | Memory | 60-second lifetime; a restart just makes the client retry |

Rate limits are counted from the `audit_logs` rows the gateway already writes for
every call, rather than a separate counter — the ledger was already there.

## Stack

| Layer | Tech |
|---|---|
| Backend / broker | FastAPI (Python 3.12), SQLAlchemy 2.0 async, asyncpg |
| Frontend | React 18 + Vite + Tailwind |
| Database | PostgreSQL 16, Alembic migrations |
| MCP server runtime | Docker, via the broker |
| stdio↔HTTP bridge | supergateway (in the runner image) |
