# API Reference

The backend is FastAPI. The documented OpenAPI schema is generated from route/model definitions, then filtered to the app-facing API surface: setup/login, invite acceptance, MCP server management, connection links, access requests, registry reads, upstream OAuth browser flows, gateway settings, SMTP settings, and `/health`.

Low-level MCP protocol routes exist in code, but are intentionally omitted from the docs because MCP clients consume them directly and they confuse normal API users. This includes `/connect`, `/.well-known/...`, `/authorize`, root `/register`, and `/token`.

## Interactive docs

With the backend running (`http://localhost:8000` in dev):

| URL | What it is |
|---|---|
| `/docs` | Marketing-style API guide with grouped endpoints and request/response examples |
| `/redoc` | Same guide, kept as a compatibility alias |
| `/swagger` | Swagger UI for trying the documented endpoints directly |
| `/openapi.json` | Filtered OpenAPI 3.x spec for the documented API |

Title/version shown there come from `server/app/core/config.py` (`APP_NAME`, `VERSION`) and the OpenAPI/docs configuration in `server/app/main.py`.

## Generating a client / exporting the spec

```bash
curl http://localhost:8000/openapi.json -o openapi.json
```

Feed that into `openapi-generator-cli`, `openapi-typescript`, Postman's importer, etc. to get typed clients or a Postman collection.

## Base URL & versioning

Most routes are mounted under `/api/v1` (see `app.include_router(..., prefix=P)` in `server/app/main.py`, where `P = "/api/v1"`). Two groups are intentionally mounted at the root instead, because they're consumed by external tools/clients rather than the MCPlama UI:

- `/connect/*` — the MCP proxy endpoint (see below)
- MCP OAuth well-known/discovery endpoints (`/.well-known/...`, `/authorize`, `/register`, `/token`)

## Authentication

- `POST /api/v1/auth/login` returns a JWT (`TokenOut.access_token`) and also sets it as an `httponly` cookie (`access_token`).
- Authenticated requests can use **either**: an `Authorization: Bearer <token>` header, or the cookie set at login (`get_current_user` in `server/app/api/v1/endpoints/auth.py` checks the header first, then falls back to the cookie).
- Admin-only routes additionally depend on `require_admin`, which checks `role == "admin"`.
- Login is rate-limited per client IP (10 attempts / 60s, in-memory).
- `POST /api/v1/auth/forgot-password` always returns `202`, whether or not the email matches an account — the response can't be used to enumerate registered emails. No-op if SMTP isn't configured. Rate-limited (5 / 5min per IP).
- `POST /api/v1/auth/reset-password` redeems the token from the emailed link and sets a new password. The token is hashed at rest, single-use, and expires after 1 hour.
- `POST /api/v1/auth/setup` is the initial admin bootstrap endpoint. It only works before an admin account exists.
- There is no public self-service signup endpoint. Users join through admin-created invite links.

There's no separate API-key mechanism for the management API — service-to-service/API access should go through a `/connect/{token}` link instead (see below), which is scoped to one user × one installed MCP server.

## Route groups (all under `/api/v1` unless noted)

| Prefix | Tag | Covers |
|---|---|---|
| `/auth` | `auth` | setup wizard, login/logout, password reset, invites, `me` |
| `/servers` | `servers` | install/configure/remove MCP servers, test connection, credential status |
| `/oauth` | `oauth` | per-server OAuth connect/callback/refresh/disconnect flows |
| `/connections` | `connections` | per-user connection tokens (what `/connect/{token}` resolves), Claude Desktop config snippet |
| `/registry` | `registry` | the browsable MCP server catalog |
| `/gateway` | `gateway` | gateway-wide stats, Claude Desktop config helper |
| `/gateway/config` | `gateway-config` | gateway name/URL settings |
| `/users` | `users` | user management (list/update/delete) |
| `/policies` | `policies` | access policies (who can call what) |
| `/audit` | `audit` | audit log query |
| `/alerts` | `alerts` | alert rules (create/toggle/delete) + on-demand check |
| `/smtp` | `smtp` | outbound email config for invites, with a test-send endpoint |
| — (root) | `requests` | access-request workflow: request access to a server, approve/deny, manage members |
| — (root) | `mcp-auth` | MCP-specific OAuth: dynamic client registration, `/authorize`, `/token`, well-known discovery documents |

Human-readable route groups and examples are in `/docs`; the direct endpoint tester is in `/swagger`; exact schemas for documented routes are in `/openapi.json`. Low-level MCP protocol plumbing and internal debug routes are intentionally omitted.

## The `/connect/{token}` proxy

Not a typical CRUD resource, so it's worth calling out separately. `server/app/api/v1/endpoints/connect.py` exposes:

```
{METHOD} /connect/{token}
{METHOD} /connect/{token}/{path:path}
```

for `GET, POST, PUT, DELETE, PATCH, OPTIONS`. This is what AI clients (Claude Desktop, Cursor, etc.) point at. Given a connection token, it:

1. resolves the token to a `(user, server)` pair,
2. re-checks access policies on every request,
3. either proxies to the server's remote endpoint or forwards into that server's Docker container,
4. writes an audit log entry (`AuditLog`) with status/latency/tool name.

Tokens are minted per user × server via `POST /api/v1/connections`, and the token can also be supplied as a `Bearer` header instead of a path segment.

## Policies (`policies_endpoint.py`)

Evaluated on every `/connect/{token}` call, scoped to a server/user/role, fail
closed (see [SECURITY-MODEL.md](SECURITY-MODEL.md)). `policy_type` is one of:

| Type | Behavior |
|---|---|
| `rate_limit` | Caps calls per user/server in a rolling window (backed by `audit_logs`) |
| `tool_block` | Denies specific tool names |
| `tool_allow` | Denies any tool not in the allow-list |
| `time_restrict` | Denies calls outside a configured time window |
| `webhook` | Delegates the decision to an admin-supplied URL |

A `webhook` policy POSTs `{server_id, user_id, tool_name, request}` to
`config.url` (SSRF-checked at save time and again at call time) and expects
back `{"allowed": bool, "reason"?: str, "mutated_request"?: object}`. Returning
`mutated_request` rewrites the outgoing JSON-RPC body before it reaches the MCP
server — every other policy type only ever allows or denies. Any timeout,
non-2xx, or malformed response is treated as a denial. `config.timeout_seconds`
is capped at 30s (default 5s).

## MCP-side OAuth (`mcp_auth.py`)

MCPlama itself acts as an OAuth authorization server towards MCP clients that support the MCP auth spec (dynamic client registration + discovery):

```
GET  /.well-known/oauth-authorization-server
GET  /.well-known/oauth-protected-resource
GET  /.well-known/oauth-protected-resource/{path}
POST /register
GET  /authorize
GET  /authorize/complete
POST /token
```

This is distinct from `/api/v1/oauth/*`, which is MCPlama acting as an OAuth *client* to authorize against the upstream service a given MCP server wraps (Notion, GitHub, etc.).
