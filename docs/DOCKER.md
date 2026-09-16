# Docker image

The published `mcplama/mcplama` image is the normal way to run MCPlama. It
contains the UI, server, bundled registry, Nginx front door, PostgreSQL, broker,
and supervisor in one self-contained image. Clone the repository and build from
source only when contributing or testing an unreleased change.

## Run the published image

```bash
docker pull mcplama/mcplama:latest
```

## Run

Use a persistent volume for the database and generated secrets. The Docker
socket is required because MCPlama launches MCP workloads through its broker.

```bash
docker run -d \
  --name mcplama \
  -p 127.0.0.1:8080:8080 \
  -v mcplama-data:/var/lib/postgresql \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e GATEWAY_URL=https://your-domain.example \
  mcplama/mcplama:latest
```

Put an HTTPS reverse proxy in front of port 8080 for public deployments. Set
`GATEWAY_URL` to the externally reachable HTTPS origin used in MCP URLs and
OAuth redirects.

The bundled image generates and persists `SECRET_KEY`,
`TOKEN_ENCRYPTION_KEY`, `BROKER_TOKEN`, and the internal database password when
they are not supplied. Managed deployments should provide them through their
secret manager instead.

## Build for development

Contributors can build the current checkout locally:

```bash
docker build -t mcplama:local .
```

For the hot-reload workflow, use [DEVELOPMENT.md](DEVELOPMENT.md) and
`docker-compose.dev.yml` instead.

## Publish a release

```bash
docker build -t mcplama/mcplama:1.0.0 .
docker push mcplama/mcplama:1.0.0
docker tag mcplama/mcplama:1.0.0 mcplama/mcplama:latest
docker push mcplama/mcplama:latest
```

For multi-architecture images, use `docker buildx build --platform` and push
the result to the registry.

## Runner image

Stdio-based MCP servers use a separate wrapper image:

Contributors can build and test it locally:

```bash
docker build -f server/Dockerfile.runner -t mcplama/runner:latest server
```

Set `RUNNER_IMAGE` when using a private registry or a pinned runner tag.

## Development

The optional contributor workflow is in `docker-compose.dev.yml`; it is not
required by users of the published image. See [DEVELOPMENT.md](DEVELOPMENT.md).
