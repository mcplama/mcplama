# Design workflow

MCPlama uses two small documentation layers for architecture work:

- **Proposals** explain a change while it is being discussed. They can be
  short and may be rejected or revised.
- **ADRs** record decisions that are expected to remain true in the shipped
  system. They should describe boundaries and consequences, not reproduce
  implementation code.

Start with [`adr/0000-template.md`](../adr/0000-template.md). Use a new
numbered file for each durable decision and link it from
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`SECURITY-MODEL.md`](SECURITY-MODEL.md), or the
relevant development guide when appropriate.

The current foundational decision is
[`ADR-0001`](../adr/0001-process-boundary-and-broker.md): Docker execution is
kept behind a typed broker, while the gateway remains responsible for API,
identity, policy, audit, and proxy orchestration.
