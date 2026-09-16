# Security model

This document describes MCPlama's technical security boundaries and production
hardening requirements. It is separate from the vulnerability disclosure policy
in [`SECURITY.md`](SECURITY.md).

## Production requirements

- Set unique `SECRET_KEY` and `TOKEN_ENCRYPTION_KEY` values.
- Set a long random `BROKER_TOKEN`.
- Set `GATEWAY_URL` to the public origin reachable by MCP clients.
- Set exact `CORS_ORIGINS` values.
- Terminate TLS before exposing the gateway.
- Redact connection tokens from access logs.

## Process boundary

The broker is the only process intended to access Docker. The backend talks to
the broker through its authenticated internal API, and runner workloads do not
receive the Docker socket.

```text
backend ──authenticated API──> broker ──Docker socket──> Docker daemon
runner  ──stdio relay─────────> broker
```

The broker accepts typed requests, rejects unknown fields, constructs Docker
arguments internally, and applies resource limits. It must not be exposed to
the public network.

The bundled image keeps the broker and backend in one container for convenient
distribution. The broker remains the only configured Docker-aware process, but
separate process/container isolation is stronger for deployments serving
untrusted tenants.
