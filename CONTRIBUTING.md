# Contributing to MCPlama

Thanks for helping improve MCPlama. The project is intentionally split into a
web application, a container broker, a runner image, and a registry so that
changes can be reviewed against a clear trust boundary.

## Before you start

Read the [architecture](docs/ARCHITECTURE.md), [security policy](docs/SECURITY.md),
and [security model](docs/SECURITY-MODEL.md) documents. In particular, the backend must not gain direct Docker socket access,
and new broker capabilities must be narrowly typed and deny unknown fields.

## Development loop

```bash
make dev                         # backend stack
cd ui && npm install             # once
make ui                          # Vite in another terminal
make check                       # compile server + build UI
```

Use the existing Alembic workflow for schema changes. Keep migrations small and
reversible where practical. Add or update documentation when a public API,
deployment option, security assumption, or operator workflow changes.

## Design changes

For changes that cross process boundaries or affect security, write a short
proposal in `adr/` before implementation. Use the template in
[`adr/0000-template.md`](adr/0000-template.md). Once the decision is settled,
record the result in an ADR and link it from the relevant architecture or
security document.

## Pull requests

- Explain the user-visible or operator-visible outcome.
- Include the security and migration impact, if any.
- Add tests or a reproducible verification command for behavior changes.
- Keep unrelated formatting and refactors out of the same change.
- Do not include credentials, private registry data, generated build output, or
  local deployment certificates.

## License

Contributions are accepted under the repository's AGPL-3.0-or-later license.
