# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Container Manager
-----------------
Manages containers for each user × server combination.

This process has NO access to the Docker socket. Every container operation goes
through the broker (app/broker/main.py), which is the only component that can
talk to Docker and which builds each `docker run` argv itself. That is the whole
point: an RCE here can ask the broker to start an MCP server — which the API
could always do — but it cannot ask for a bind mount, a capability, or a
privileged container, because no request shape expresses those.
"""
import asyncio
import logging
import os
from typing import Optional
from datetime import datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

IDLE_TIMEOUT = 300
RUNNER_IMAGE = os.environ.get("RUNNER_IMAGE", "mcplama/runner:latest")
MCPLAMA_NETWORK = "mcplama"

# Per-session supergateway instances exec'd inside one shared container each
# get their own port from this range, so concurrent sessions never collide.
SESSION_PORT_MIN = 8001
SESSION_PORT_MAX = 8050

BROKER_URL = os.environ.get("BROKER_URL", "http://broker:9000").rstrip("/")
BROKER_TOKEN = os.environ.get("BROKER_TOKEN", "")
BROKER_HOST = os.environ.get("BROKER_HOST", "broker")

_TIMEOUT = httpx.Timeout(180.0, connect=10.0)


class ContainerInfo:
    def __init__(self, name: str, container_id: str, port: int = 0):
        self.name = name
        self.container_id = container_id
        self.port = port
        self.container_name = name
        self.last_used = datetime.utcnow()

    def touch(self):
        self.last_used = datetime.utcnow()

    def is_idle(self) -> bool:
        return datetime.utcnow() - self.last_used > timedelta(seconds=IDLE_TIMEOUT)


_containers: dict[str, ContainerInfo] = {}
# container name -> broker stdio relay port, so the relay is torn down with it
_stdio_ports: dict[str, int] = {}


class SessionInfo:
    """One per-session supergateway instance exec'd inside a shared container."""

    def __init__(self, container_name: str, listen_port: int, stdio_port: Optional[int]):
        self.container_name = container_name
        self.listen_port = listen_port
        self.stdio_port = stdio_port  # broker stdio-relay port backing it, if any (docker/stdio runtime)
        self.last_used = datetime.utcnow()

    def touch(self):
        self.last_used = datetime.utcnow()

    def is_idle(self) -> bool:
        return datetime.utcnow() - self.last_used > timedelta(seconds=IDLE_TIMEOUT)


# (container_name, listen_port) -> SessionInfo
_session_pool: dict[tuple[str, int], SessionInfo] = {}
# container_name -> listen_ports currently allocated on it
_session_ports_used: dict[str, set] = {}


def _container_name(server_slug: str, user_id: Optional[int], auth_mode: str) -> str:
    if auth_mode == "shared":
        return f"mcplama-{server_slug}-shared"
    return f"mcplama-{server_slug}-u{user_id}"


def needs_session_multiplexing(runtime: str, transport: str, auth_mode: str) -> bool:
    """
    True for shared servers backed by a 1:1 stdio process (docker+stdio,
    npx, uvx) — these need a dedicated supergateway instance per session
    (open_session/close_session) rather than one shared instance for the
    whole container, which only ever tolerates a single live session.
    """
    if auth_mode != "shared":
        return False
    if runtime == "docker":
        return transport == "stdio"
    return runtime in ("npx", "uvx")


def effective_auth_mode(auth_mode: str) -> str:
    """auth_mode=none servers run one shared container, same as auth_mode=shared.

    Callers computing a container name to stop/look up must go through this —
    passing the raw server.auth_mode.value for a "none" server names a
    "-u{id}" container that was never started, silently no-oping the stop.
    """
    return "shared" if auth_mode == "none" else auth_mode


# ── Broker client ─────────────────────────────────────────────────────────────

async def _broker(method: str, path: str, **kw):
    headers = {"X-Broker-Token": BROKER_TOKEN}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            r = await client.request(method, f"{BROKER_URL}{path}", headers=headers, **kw)
        except httpx.ConnectError as e:
            raise RuntimeError(f"Container broker unreachable at {BROKER_URL}: {e}")
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        raise RuntimeError(f"Broker error {r.status_code}: {r.text[:300]}")
    return r.json()


async def _docker_available() -> bool:
    try:
        info = await _broker("GET", "/docker/info")
        return bool(info and info.get("docker_available"))
    except Exception as e:
        logger.warning(f"Broker docker check failed: {e}")
        return False


async def docker_info() -> dict:
    """Backs the admin /debug/docker endpoint."""
    try:
        return await _broker("GET", "/docker/info") or {}
    except Exception as e:
        return {"docker_available": False, "images": [], "running_containers": [], "error": str(e)}


async def _container_running(name: str) -> Optional[str]:
    try:
        res = await _broker("GET", f"/containers/{name}")
    except Exception:
        return None
    return res.get("id") if res else None


# ── Args ──────────────────────────────────────────────────────────────────────

_BLOCKED_DOCKER_FLAGS = {
    "--privileged", "--pid", "--userns", "--cgroupns",
    "--cap-add", "--security-opt", "--device",
    "--network=host", "--ipc=host",
}


def _validate_docker_args(docker_args: list) -> list:
    """
    Reject flag-shaped docker_args.

    These land after the image name, so the daemon already treats them as the
    container's argv rather than as flags — the broker could not turn them into
    docker options even if it wanted to. Kept as a cheap sanity check so a
    confused config surfaces as an error instead of being silently handed to an
    entrypoint that will not understand it.
    """
    for arg in docker_args:
        flag = str(arg).split("=")[0].lower()
        if flag in _BLOCKED_DOCKER_FLAGS or str(arg).lower() in _BLOCKED_DOCKER_FLAGS:
            raise ValueError(f"Blocked docker_arg: {arg!r}")
    return docker_args


def _sg_cmd(inner: str, port: int) -> str:
    # --stateful: without it supergateway treats every unsessioned request as
    # its own session and spawns a fresh child process per request — for a
    # docker+stdio image (e.g. mcp/playwright) that's a brand-new `docker run`
    # per MCP call instead of one process reused for the container's lifetime.
    # stdio_bridge.py already tracks and replays Mcp-Session-Id for exactly
    # this; it just never had a stateful backend to pair with.
    return (
        f"npx -y supergateway --stdio {inner} "
        f"--port {port} --outputTransport streamableHttp --stateful --logLevel debug"
    )


def _q(s: str) -> str:
    import shlex
    return shlex.quote(str(s))


def _apt_prefix(system_packages: Optional[list]) -> str:
    """
    Shell prefix that installs `system_packages` via apt before the real
    npx/uvx command runs, so a package like `mcp-server-git` that shells out
    to a missing `git` binary can be unblocked from a plain admin-entered
    package name instead of a custom Dockerfile/image.

    `dpkg -s` gate skips the (slower) update+install once a package is
    already present — the container image itself is ephemeral per restart,
    but a shared container's already-running lifetime, and each session
    spawned into it, would otherwise re-run apt on every single session.
    """
    pkgs = [str(p).strip() for p in (system_packages or []) if str(p).strip()]
    if not pkgs:
        return ""
    quoted = " ".join(_q(p) for p in pkgs)
    return (
        f"(dpkg -s {quoted} >/dev/null 2>&1 || "
        f"(apt-get update -qq && apt-get install -y -qq --no-install-recommends {quoted})) && "
    )


# ── Lifecycle ─────────────────────────────────────────────────────────────────

async def start_container(
    server_slug: str,
    runtime: str,
    docker_image: Optional[str],
    package: Optional[str],
    args: Optional[list],
    docker_args: Optional[list],
    container_port: int,
    env: dict[str, str],
    user_id: Optional[int],
    auth_mode: str,
    transport: str = "http",
    cpu_limit: Optional[str] = None,
    memory_limit: Optional[str] = None,
    system_packages: Optional[list] = None,
) -> ContainerInfo:
    name = _container_name(server_slug, user_id, auth_mode)

    existing_id = await _container_running(name)
    if existing_id:
        logger.info(f"Container {name} already running ({existing_id})")
        if name not in _containers:
            _containers[name] = ContainerInfo(name=name, container_id=existing_id, port=container_port)
        _containers[name].touch()
        return _containers[name]

    from app.services.stdio_bridge import clear_session
    clear_session(name)
    await _release_stdio(name)

    if not await _docker_available():
        raise RuntimeError("Docker is not available (broker reports no daemon).")

    labels = {
        "mcplama.server": server_slug,
        "mcplama.port": str(container_port),
    }
    extra = _validate_docker_args(docker_args or [])

    # Shared containers hold no supergateway of their own — every real client
    # session gets its own instance, docker-exec'd on demand (see
    # open_session/close_session below). Starting one here and reusing it for
    # every session was the bug: supergateway only tolerates one live session
    # per process, so a second connection collided with (and could kill) the
    # first's still-active session. The container itself just idles.
    if needs_session_multiplexing(runtime, transport, auth_mode):
        spec = {
            "name": name, "image": RUNNER_IMAGE, "port": container_port,
            "env": {}, "shell": "tail -f /dev/null", "labels": labels,
            "cpu_limit": cpu_limit, "memory_limit": memory_limit,
        }
    elif runtime == "docker":
        image = docker_image or package
        if not image:
            raise RuntimeError("No Docker image specified (docker_image and package are both empty).")

        if transport == "stdio":
            # The image speaks stdio. The broker runs it and relays its stdin/
            # stdout over TCP; the runner reaches it with socat. Previously this
            # was docker-in-docker and the runner held the Docker socket, which
            # made every MCP image one step from host root.
            session = await _broker("POST", "/stdio-sessions", json={
                "image": image,
                "env": env,
                "cmd": [str(a) for a in extra],
                "cpu_limit": cpu_limit, "memory_limit": memory_limit,
            })
            port = session["port"]
            _stdio_ports[name] = port
            inner = _q(f"socat - TCP:{BROKER_HOST}:{port}")
            spec = {
                "name": name, "image": RUNNER_IMAGE, "port": container_port,
                "env": {}, "shell": _sg_cmd(inner, container_port), "labels": labels,
                "cpu_limit": cpu_limit, "memory_limit": memory_limit,
            }
        else:
            spec = {
                "name": name, "image": image, "port": container_port,
                "env": env, "cmd": [str(a) for a in extra], "labels": labels,
                "cpu_limit": cpu_limit, "memory_limit": memory_limit,
            }

    elif runtime in ("npx", "uvx"):
        if runtime == "npx":
            inner_raw = f"npx -y {_q(package)}"
        else:
            inner_raw = f"uvx {_q(package)}"
        if args:
            inner_raw += " " + " ".join(_q(a) for a in args)
        inner_raw = _apt_prefix(system_packages) + inner_raw
        spec = {
            "name": name, "image": RUNNER_IMAGE, "port": container_port,
            "env": env, "shell": _sg_cmd(_q(inner_raw), container_port), "labels": labels,
            "cpu_limit": cpu_limit, "memory_limit": memory_limit,
        }
    else:
        raise ValueError(f"Unknown runtime: {runtime}")

    res = await _broker("POST", "/containers", json=spec)
    container_id = res["id"]

    for _ in range(30):
        if await _container_running(name):
            break
        await asyncio.sleep(1)
    else:
        raise RuntimeError(f"Container {name} failed to start within 30 seconds")

    info = ContainerInfo(name=name, container_id=container_id, port=container_port)
    _containers[name] = info
    logger.info(f"Container {name} started (internal port {container_port})")
    return info


async def _release_stdio(name: str):
    port = _stdio_ports.pop(name, None)
    if port:
        try:
            await _broker("DELETE", f"/stdio-sessions/{port}")
        except Exception as e:
            logger.warning(f"Failed to close stdio session {port}: {e}")


async def stop_container(name: str):
    try:
        await close_sessions_for_container(name)
        await _broker("DELETE", f"/containers/{name}")
        _containers.pop(name, None)
        await _release_stdio(name)
        _session_ports_used.pop(name, None)
        from app.services.stdio_bridge import clear_session
        clear_session(name)
        logger.info(f"Container {name} stopped")
    except Exception as e:
        logger.warning(f"Failed to stop {name}: {e}")


async def close_sessions_for_container(name: str):
    """Close all tracked per-session processes hosted by a shared container."""
    ports = [port for (container_name, port) in list(_session_pool.keys()) if container_name == name]
    for port in ports:
        await close_session(name, port)


async def stop_server_containers(server_slug: str, user_ids: list[int], auth_mode: str):
    """
    Stop every container name the app can create for a server.

    Shared and no-auth servers always use the server-level shared name, even
    when there are no connection rows. Per-user servers use one name per user.
    """
    effective = effective_auth_mode(auth_mode)
    names = {_container_name(server_slug, None, "shared")}
    if effective == "per_user":
        names.update(_container_name(server_slug, user_id, "per_user") for user_id in user_ids)
    for name in names:
        await stop_container(name)


async def get_container(
    server_slug: str,
    user_id: Optional[int],
    auth_mode: str,
) -> Optional[ContainerInfo]:
    name = _container_name(server_slug, user_id, auth_mode)
    existing_id = await _container_running(name)
    if not existing_id:
        _containers.pop(name, None)
        return None
    if name in _containers:
        _containers[name].touch()
        return _containers[name]
    return None


async def cleanup_idle():
    await cleanup_idle_sessions()
    # Never reap a shared container while a session is still live inside it —
    # the container itself is just a keepalive shell, but killing it kills
    # every docker-exec'd supergateway instance running inside.
    hosting_sessions = {name for (name, _port) in _session_pool.keys()}
    idle = [name for name, info in list(_containers.items())
            if info.is_idle() and name not in hosting_sessions]
    for name in idle:
        logger.info(f"Stopping idle container {name}")
        await stop_container(name)


async def open_session(
    server_slug: str,
    runtime: str,
    docker_image: Optional[str],
    package: Optional[str],
    args: Optional[list],
    docker_args: Optional[list],
    container_port: int,
    env: dict[str, str],
    cpu_limit: Optional[str] = None,
    memory_limit: Optional[str] = None,
    system_packages: Optional[list] = None,
) -> tuple[str, int]:
    """
    Mint a dedicated supergateway instance, docker-exec'd inside the shared
    container for this server, backing exactly one external MCP session.

    This is what makes a "shared" server safe for concurrent clients: the
    container is reused (no sprawl), but each session gets its own process
    instead of racing others for the one session a shared supergateway
    instance can hold.
    """
    name = _container_name(server_slug, None, "shared")

    if not await _container_running(name):
        # cpu_limit/memory_limit apply to the shared container itself — every
        # docker-exec'd session below inherits its cgroup, so there's nothing
        # additional to set per-session.
        await start_container(
            server_slug=server_slug, runtime=runtime, docker_image=docker_image,
            package=package, args=args, docker_args=docker_args,
            container_port=container_port, env={}, user_id=None, auth_mode="shared",
            transport="stdio" if runtime == "docker" else "http",
            cpu_limit=cpu_limit, memory_limit=memory_limit,
        )

    extra = _validate_docker_args(docker_args or [])
    stdio_port: Optional[int] = None
    spawn_env: dict[str, str] = {}

    if runtime == "docker":
        image = docker_image or package
        if not image:
            raise RuntimeError("No Docker image specified (docker_image and package are both empty).")
        session = await _broker("POST", "/stdio-sessions", json={
            "image": image,
            "env": env,
            "cmd": [str(a) for a in extra],
            "cpu_limit": cpu_limit,
            "memory_limit": memory_limit,
        })
        stdio_port = session["port"]
        inner = _q(f"socat - TCP:{BROKER_HOST}:{stdio_port}")
    elif runtime in ("npx", "uvx"):
        inner_raw = f"npx -y {_q(package)}" if runtime == "npx" else f"uvx {_q(package)}"
        if args:
            inner_raw += " " + " ".join(_q(a) for a in args)
        inner_raw = _apt_prefix(system_packages) + inner_raw
        inner = _q(inner_raw)
        spawn_env = env
    else:
        raise ValueError(f"Unknown runtime for session: {runtime}")

    used = _session_ports_used.setdefault(name, set())
    # The in-memory set is lost when the backend restarts, but docker-exec'd
    # supergateway processes can survive inside the shared runner container.
    # Probe the actual listener before selecting a port so a stale 8001 (or
    # any other orphaned session) is skipped instead of causing EADDRINUSE.
    async def _port_is_occupied(candidate: int) -> bool:
        import httpx as _httpx
        try:
            async with _httpx.AsyncClient(timeout=_httpx.Timeout(0.4, connect=0.2)) as client:
                await client.get(f"http://{name}:{candidate}/")
                return True
        except _httpx.ConnectError:
            return False
        except Exception:
            # A listener that is not HTTP is still occupied and must not be
            # handed to a new supergateway process.
            return True

    for listen_port in range(SESSION_PORT_MIN, SESSION_PORT_MAX + 1):
        if listen_port not in used and not await _port_is_occupied(listen_port):
            break
    else:
        raise RuntimeError(f"No free session ports on {name}")
    used.add(listen_port)

    try:
        await _broker("POST", f"/containers/{name}/spawn", json={
            "inner": inner, "listen_port": listen_port, "env": spawn_env,
        })
    except Exception:
        used.discard(listen_port)
        if stdio_port:
            await _broker("DELETE", f"/stdio-sessions/{stdio_port}")
        raise

    _session_pool[(name, listen_port)] = SessionInfo(name, listen_port, stdio_port)

    # `docker exec -d` returns as soon as the process is launched, not once
    # supergateway is actually listening — give it a moment before the
    # caller's real request lands, or it just sees connection-refused. A
    # system_packages install runs first inside that same command (apt-get
    # update can take a while on a cold cache), so it gets a longer budget
    # than the plain "just start the child process" case.
    import httpx as _httpx
    url = f"http://{name}:{listen_port}/"
    poll_attempts, poll_interval = (90, 0.5) if system_packages else (30, 0.3)
    reachable = False
    for _ in range(poll_attempts):
        try:
            async with _httpx.AsyncClient(timeout=_httpx.Timeout(1.0)) as client:
                await client.get(url)
                reachable = True
                break
        except _httpx.ConnectError:
            await asyncio.sleep(poll_interval)
        except Exception:
            # Not a connection refusal, so *something* is listening — treat
            # it the same as a successful poll (matches prior behaviour).
            reachable = True
            break

    if not reachable:
        # Nothing ever answered — the spawned process crashed before it
        # could bind its port (e.g. a bad package name failing dependency
        # resolution). Tear it down and free the port instead of handing
        # back a session that will only ever fail, silently, downstream.
        logger.warning(f"Session {name}:{listen_port} never came up — killing it and freeing the port")
        await close_session(name, listen_port)
        raise RuntimeError(
            f"Server process on {name}:{listen_port} failed to start — check its session logs for the real error."
        )

    # supergateway itself answering GET / only proves *it* is listening, not
    # that the stdio child behind it (npx/uvx) is ready — a first-ever run of
    # a package still has to download its deps, which can take much longer
    # than that. If the caller's real initialize is the one that lands during
    # that window, supergateway's own reply-after-the-caller-gave-up crashes
    # the whole Node process ("No connection established for request ID"),
    # taking the freshly opened session down with it. `_pre_initialize` (the
    # same warmup already used for non-multiplexed containers, see
    # wait_for_container) absorbs that cold-start cost here instead, so the
    # caller's own initialize right after this always hits an already-warm
    # child.
    from app.services.stdio_bridge import _pre_initialize
    await _pre_initialize(name, listen_port, "/mcp")

    logger.info(f"Opened session {name}:{listen_port}")
    return name, listen_port


async def close_session(container_name: str, listen_port: int):
    info = _session_pool.pop((container_name, listen_port), None)

    try:
        await _broker("DELETE", f"/containers/{container_name}/spawn/{listen_port}")
    except Exception as e:
        logger.warning(f"Failed to kill session {container_name}:{listen_port}: {e}")

    # Only free the port for reuse once the kill call has actually been
    # issued and awaited — freeing it beforehand let a new session grab the
    # same port while the old process was still alive and bound to it,
    # crashing the new spawn with EADDRINUSE (the old, now-orphaned process
    # then goes on answering the new session's requests with whatever it
    # feels like, e.g. a stray 400 on tools/list).
    _session_ports_used.get(container_name, set()).discard(listen_port)

    if info and info.stdio_port:
        try:
            await _broker("DELETE", f"/stdio-sessions/{info.stdio_port}")
        except Exception as e:
            logger.warning(f"Failed to release stdio session {info.stdio_port}: {e}")

    from app.services.stdio_bridge import clear_session, _session_routes
    clear_session(f"{container_name}:{listen_port}")
    # Idle reaping closes sessions without knowing the external session ID
    # connect.py mapped to them — drop any route that still points here so it
    # doesn't get handed out again after the port is reused.
    stale = [sid for sid, target in _session_routes.items() if target == (container_name, listen_port)]
    for sid in stale:
        _session_routes.pop(sid, None)
    logger.info(f"Closed session {container_name}:{listen_port}")


def touch_session(container_name: str, listen_port: int):
    info = _session_pool.get((container_name, listen_port))
    if info:
        info.touch()
    if container_name in _containers:
        _containers[container_name].touch()


async def cleanup_idle_sessions():
    idle = [key for key, info in list(_session_pool.items()) if info.is_idle()]
    for name, port in idle:
        logger.info(f"Closing idle session {name}:{port}")
        await close_session(name, port)


async def get_container_logs(name: str, tail: int = 200) -> str:
    """`docker logs` for a container whose own entrypoint is the MCP process
    (non-multiplexed npx/uvx/docker containers) — used to diagnose a crash
    that a test-connection HTTP call alone can't explain."""
    try:
        res = await _broker("GET", f"/containers/{name}/logs", params={"tail": tail})
        return (res or {}).get("logs", "")
    except Exception as e:
        logger.warning(f"Failed to fetch logs for {name}: {e}")
        return ""


async def get_stdio_logs(name: str, tail: int = 200) -> str:
    """Logs from the broker-owned Docker process behind a docker/stdio server."""
    port = _stdio_ports.get(name)
    if not port:
        return ""
    try:
        res = await _broker("GET", f"/stdio-sessions/{port}/logs", params={"tail": tail})
        return (res or {}).get("logs", "")
    except Exception as e:
        logger.warning(f"Failed to fetch stdio logs for {name}:{port}: {e}")
        return ""


async def get_session_logs(container_name: str, listen_port: int, tail: int = 200) -> str:
    """Logs for one docker-exec'd session inside a shared/multiplexed
    container — its stdout/stderr never reach `docker logs` on the shared
    container itself (see broker spawn_session), only the per-session log
    file it redirects to."""
    try:
        res = await _broker("GET", f"/containers/{container_name}/spawn/{listen_port}/logs", params={"tail": tail})
        return (res or {}).get("logs", "")
    except Exception as e:
        logger.warning(f"Failed to fetch session logs for {container_name}:{listen_port}: {e}")
        return ""


async def list_running() -> list[dict]:
    try:
        return await _broker("GET", "/containers") or []
    except Exception as e:
        logger.warning(f"Broker list failed: {e}")
        return []


async def remove_image(image: str) -> dict:
    try:
        return await _broker("POST", "/images/remove", json={"image": image}) or {}
    except Exception as e:
        logger.warning(f"Failed to remove image {image}: {e}")
        return {"removed": False, "error": str(e)}


async def sweep_image(image: str) -> dict:
    try:
        return await _broker("POST", "/sweep-image", json={"image": image}) or {}
    except Exception as e:
        logger.warning(f"Failed to sweep image {image}: {e}")
        return {"removed": 0, "error": str(e)}


async def pull_image(image: str) -> dict:
    return await _broker("POST", "/images/pull", json={"image": image}) or {}


async def cleanup_all():
    for c in await list_running():
        name = (c.get("Names") or "").lstrip("/")
        if name:
            await stop_container(name)
