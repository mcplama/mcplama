# ADR-0001: Keep container execution behind a typed broker

- Status: accepted
- Date: 2026-09-14
- Owners: MCPlama maintainers

## Context

The gateway accepts requests from AI clients and administrators, while Docker
socket access can control the host. Combining those responsibilities would make
an application compromise equivalent to host-level control.

## Decision

MCPlama keeps the API gateway and container broker as separate processes. The
gateway asks the broker to perform a small set of runtime operations. Broker
requests use strict schemas, reject unknown fields, and are converted into
Docker arguments inside the broker. The broker is the only process that may
access the Docker socket in the multi-container deployment. The runner image
does not receive that socket; stdio workloads use the broker's relay.

The public application remains organized by responsibility:

```text
clients -> API gateway -> domain services -> persistence
                    \\-> policy, audit, and credential boundaries
                    \\-> typed broker -> isolated MCP workload
registry/catalog -> installation metadata
frontend          -> operator and connection UI
```

## Alternatives considered

- Giving the backend direct Docker access: simpler, but expands the impact of
  an API vulnerability to the host.
- Letting runner containers start their own workloads: convenient for stdio,
  but requires distributing the Docker socket to untrusted runtime code.
- Moving every responsibility into one service: fewer deployment units, but
  weaker reviewable boundaries and less useful least-privilege controls.

## Consequences

The broker adds an internal API and some lifecycle coordination. In exchange,
the security boundary is visible in deployment files, code ownership, and the
architecture documentation. Production deployments should use the
multi-container layout when process isolation matters; the bundled image is a
convenience distribution with a weaker local boundary.

## Verification

- Confirm only `broker` mounts `/var/run/docker.sock` in
  `docker-compose.dev.yml`.
- Confirm broker request models use `extra="forbid"`.
- Run the end-to-end MCP harness after changes to auth, proxying, or runtime
  lifecycle code.
- Review the production checklist in `docs/SECURITY-MODEL.md` before deployment.
