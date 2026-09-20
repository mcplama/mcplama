# Install and run with Docker

The published `mcplama/mcplama` image includes the dashboard, API, PostgreSQL,
broker, registry, and Nginx. Docker is also used to start MCP server containers.

## Recommended host specifications

These are starting recommendations for the MCPlama host, including headroom for
the database, audit logs, and managed MCP containers. Actual needs depend on
the MCP servers you run and how many are active at once. Monitor resource use
and scale up as concurrency and audit log volume grow.

| Tier | Concurrent users | Installed servers | Audit log storage | CPU | RAM | Disk |
|---|---:|---:|---:|---:|---:|---:|
| Small | ~10 | up to 20 | under 100 MB | 2 vCPU | 2 GB | 10 GB |
| Team | ~100 | ~100 | ~1 GB | 4 vCPU | 4 GB | 20 GB |
| Growing | ~250 | up to 500 | ~5 GB | 4–8 vCPU | 8 GB | 30 GB |
| Large | 500+ | 500+ | 10 GB+ | 8 vCPU | 16 GB | 50 GB+ |

These are infrastructure estimates, not edition limits or performance
guarantees. The Community edition supports up to 10 users and 100 installed
servers; higher limits require an Enterprise license. Docker needs to be
installed and running on the host. The MCPlama container needs access to the
Docker socket to manage MCP containers.

## Install

Pull the image (optional; `docker run` also pulls it when needed):

```bash
docker pull mcplama/mcplama:latest
```

Choose the port binding and `GATEWAY_URL` for how people and MCP clients will
reach the instance.

### Local access or a reverse proxy

For local-only access, or when a reverse proxy on the same host provides HTTPS,
bind port 8080 to localhost:

```bash
docker run -d --name mcplama \
  -p 127.0.0.1:8080:8080 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v mcplama-data:/var/lib/postgresql \
  -e GATEWAY_URL=http://localhost:8080 \
  mcplama/mcplama:latest
```

For a public HTTPS deployment, set `GATEWAY_URL` to the public URL instead,
such as `https://mcplama.example.com`. Configure the reverse proxy to forward
that hostname to `http://127.0.0.1:8080`. The proxy must support long-lived
streaming responses for MCP connections. Keep the MCPlama host port private
and expose only the proxy's HTTPS port.

### Direct access on the host network

Use this only when you intend to expose MCPlama directly without a reverse
proxy. Configure the host firewall and set `GATEWAY_URL` to the address and
port clients will use:

```bash
docker run -d --name mcplama \
  -p 8080:8080 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v mcplama-data:/var/lib/postgresql \
  -e GATEWAY_URL=http://mcplama.example.com:8080 \
  mcplama/mcplama:latest
```

To use a different host port, for example `8043`, map it to the container's
port 8080 (`-p 8043:8080`) and include `:8043` in `GATEWAY_URL`.

### Docker network

At startup, MCPlama creates the Docker network named `mcplama` if needed and
joins it. Managed MCP containers use this network to reach the broker. You do
not need to create it manually.

## Finish setup and keep data safe

Open the `GATEWAY_URL` in a browser and follow the setup wizard to create the
admin account. The named `mcplama-data` volume stores PostgreSQL data and the
generated signing, encryption, and database keys. Keep this volume when
recreating or upgrading the container, and back it up together with the
database. Restoring the database without the matching keys can make saved
credentials unreadable.

The broker token is generated at startup and shared between the backend and
broker processes in the bundled image. You normally do not need to set it.
Managed deployments can provide secrets through environment variables or their
secret manager.

## MCP server resources and runner image

CPU and memory limits for managed MCP servers can be set in the Add server and
Edit server forms. The broker caps those limits to configured maximums and to
the resources available on the host. If Docker rejects a server's resource
limits, lower them in the server settings. Values such as CPU `1` and memory
`256m` are useful starting points for small servers.

npx, uvx, and stdio-based servers use the `mcplama/runner:latest` image, which
MCPlama pulls automatically when needed. The host needs access to the image
registry. For a private registry or mirror, set `RUNNER_IMAGE` to the image
reference you want to use.

## Build from source

Contributors can build the published image from the repository root:

```bash
docker build -t mcplama/mcplama:local .
```

For the hot-reload workflow, use [DEVELOPMENT.md](DEVELOPMENT.md) and
`docker-compose.dev.yml`. To build the runner image locally:

```bash
docker build -f server/Dockerfile.runner -t mcplama/runner:latest server
```
