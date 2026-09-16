# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Container Broker
================
The ONLY component that may talk to /var/run/docker.sock.

Why this exists
---------------
The Docker socket is root on the host: anyone who can reach it can ask the
daemon for `-v /:/host --privileged` and walk out with the machine. Previously
the socket was mounted into the backend *and* into every stdio runner container
— so an RCE in the API, or a single malicious MCP image pulled from a registry,
was one command away from host root.

Validating flags in the caller could never fix that: the caller is exactly what
gets compromised. The control has to sit on the other side of the boundary.

So the broker exposes a small, closed API — "run this image, with this env, on
the internal network" — and *builds the docker argv itself*. Callers pass data,
never flags. There is no request shape that produces a bind mount, a capability
add, a host namespace, or a privileged container: those strings are simply never
emitted. Compromising the backend now buys an attacker the ability to start an
MCP server, which it could already do, and nothing more.

Talking stdio without the socket
--------------------------------
stdio MCP images used to require docker-in-docker: the runner held the socket so
supergateway could `docker run -i` the real image. Instead the broker owns that
process and relays its stdin/stdout over a plain TCP port on the internal
network. The runner connects with `socat` and never sees Docker at all.
"""
import asyncio
import json
import logging
import os
import re
import secrets
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s broker: %(message)s")
logger = logging.getLogger(__name__)

BROKER_TOKEN = os.environ.get("BROKER_TOKEN", "")
MCPLAMA_NETWORK = os.environ.get("MCPLAMA_NETWORK", "mcplama")
# The shared wrapper image every npx/uvx/stdio server runs inside of. Never a
# valid target for image removal — deleting it would break every other server.
RUNNER_IMAGE = os.environ.get("RUNNER_IMAGE", "mcplama/runner:latest")

# Resource ceilings applied to every container the broker starts. Callers cannot
# raise or remove these — a caller-supplied cpu_limit/memory_limit is only ever
# honored up to these values (see _resource_flags), never trusted as-is.
MEM_LIMIT = os.environ.get("BROKER_MEM_LIMIT", "1g")
MAX_CPU_LIMIT = os.environ.get("BROKER_MAX_CPU_LIMIT", "4")
PIDS_LIMIT = os.environ.get("BROKER_PIDS_LIMIT", "512")

# TCP ports used for stdio relays, allocated inside the internal network only.
STDIO_PORT_MIN = 10000
STDIO_PORT_MAX = 10999

app = FastAPI(title="MCPlama Container Broker")


def _auth(token: Optional[str]) -> None:
    if not BROKER_TOKEN:
        raise HTTPException(500, "Broker is not configured with a token")
    if not token or not secrets.compare_digest(token, BROKER_TOKEN):
        raise HTTPException(401, "Invalid broker token")


async def _run(cmd: list[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode().strip(), err.decode().strip()


def _env_args(env: dict[str, str]) -> list[str]:
    args = []
    for k, v in env.items():
        args.extend(["-e", f"{k}={v}"])
    return args


_MEM_UNITS = {"b": 1, "k": 1024, "m": 1024**2, "g": 1024**3}
_MEM_RE = re.compile(r"^(\d+(?:\.\d+)?)([bkmg]?)$", re.IGNORECASE)


def _parse_memory_bytes(value: str) -> Optional[float]:
    m = _MEM_RE.match(value.strip()) if value else None
    if not m:
        return None
    num, unit = m.groups()
    return float(num) * _MEM_UNITS[unit.lower() or "b"]


def _parse_cpus(value: str) -> Optional[float]:
    try:
        parsed = float(value.strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _available_cpus() -> Optional[float]:
    """Return CPUs available to this process, when the platform exposes it."""
    try:
        return float(len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        return float(os.cpu_count()) if os.cpu_count() else None


def _available_memory_bytes() -> Optional[float]:
    """Return the memory visible to this process, when available."""
    try:
        with open("/proc/meminfo", encoding="utf-8") as meminfo:
            for line in meminfo:
                if line.startswith("MemTotal:"):
                    return float(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def _resource_flags(cpu_limit: Optional[str], memory_limit: Optional[str]) -> list[str]:
    """
    Resolves the --memory/--cpus flags for a container.

    A caller-supplied value is honored only if it parses and does not exceed
    the broker's ceiling (MEM_LIMIT / MAX_CPU_LIMIT) — the caller is never
    trusted to have already clamped it itself, same as every other flag this
    file builds. Missing or invalid values fall back to the ceiling.
    """
    configured_ceiling_bytes = _parse_memory_bytes(MEM_LIMIT)
    available_memory_bytes = _available_memory_bytes()
    memory_ceilings = [v for v in (configured_ceiling_bytes, available_memory_bytes) if v is not None]
    ceiling_bytes = min(memory_ceilings) if memory_ceilings else None
    requested_bytes = _parse_memory_bytes(memory_limit) if memory_limit else None
    if requested_bytes is not None and ceiling_bytes is not None and requested_bytes <= ceiling_bytes:
        mem = memory_limit
    else:
        mem = str(int(ceiling_bytes)) if ceiling_bytes is not None else MEM_LIMIT

    configured_ceiling_cpus = _parse_cpus(MAX_CPU_LIMIT)
    available_cpus = _available_cpus()
    ceilings = [v for v in (configured_ceiling_cpus, available_cpus) if v is not None]
    ceiling_cpus = min(ceilings) if ceilings else None
    requested_cpus = _parse_cpus(cpu_limit) if cpu_limit else None
    if requested_cpus is not None and ceiling_cpus is not None and requested_cpus <= ceiling_cpus:
        cpu = cpu_limit
    else:
        cpu = str(ceiling_cpus) if ceiling_cpus is not None else MAX_CPU_LIMIT

    return ["--memory", mem, "--cpus", cpu]


def _hardening(cpu_limit: Optional[str] = None, memory_limit: Optional[str] = None) -> list[str]:
    """
    Applied to every container, unconditionally. Not caller-controllable beyond
    the clamped cpu_limit/memory_limit values (see _resource_flags).

    no-new-privileges blocks setuid escalation inside the container; the memory,
    cpu, and pid ceilings stop one MCP server from taking the host down with it.
    Note what is absent and can never be added by a caller: -v, --privileged,
    --cap-add, --device, --pid=host, --network=host.
    """
    return [
        "--security-opt", "no-new-privileges",
        *_resource_flags(cpu_limit, memory_limit),
        "--pids-limit", PIDS_LIMIT,
        "--label", "mcplama=true",
    ]


async def _ensure_network() -> None:
    code, _, _ = await _run(["docker", "network", "inspect", MCPLAMA_NETWORK])
    if code != 0:
        await _run(["docker", "network", "create", MCPLAMA_NETWORK])


async def _pull(image: str) -> None:
    code, _, _ = await _run(["docker", "image", "inspect", image])
    if code == 0:
        return
    logger.info(f"pulling {image}")
    code, out, err = await _run(["docker", "pull", image])
    if code != 0:
        if image == RUNNER_IMAGE:
            raise HTTPException(
                400,
                "Failed to pull MCPlama runner image "
                f"'{image}'. NPX, UVX, and stdio-based MCP servers require this image. "
                "Check registry access, run docker login if needed, or set RUNNER_IMAGE "
                "to a reachable mirror.",
            )
        raise HTTPException(400, f"Failed to pull image '{image}': {err or out}")


# ── Models ────────────────────────────────────────────────────────────────────

# extra="forbid" everywhere: an unknown field is a caller trying to reach a
# docker option we do not expose (volumes, privileged, cap_add...). Dropping it
# silently would be safe, but rejecting it is honest — the caller learns the
# capability does not exist rather than believing it was applied.
class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PullSpec(_Strict):
    image: str


class SweepSpec(_Strict):
    image: str


class StartSpec(_Strict):
    """
    A container to start. Deliberately expresses *what* to run, never *how* —
    there is no field here that can become a docker flag.
    """
    name: str
    image: str
    port: int = 8000
    env: dict[str, str] = Field(default_factory=dict)
    # Appended after the image, i.e. argv for the container's entrypoint. These
    # cannot be docker flags: by this point the image name has already been
    # consumed, so the daemon treats everything following it as the command.
    cmd: list[str] = Field(default_factory=list)
    # Optional `sh -c` payload, used for the supergateway runner.
    shell: Optional[str] = None
    labels: dict[str, str] = Field(default_factory=dict)
    # Per-server overrides, clamped server-side against MEM_LIMIT/MAX_CPU_LIMIT
    # in _resource_flags — never honored as-is (see _hardening's docstring).
    cpu_limit: Optional[str] = None
    memory_limit: Optional[str] = None


class StdioSpec(_Strict):
    """An stdio MCP image whose stdin/stdout the broker will relay over TCP."""
    image: str
    env: dict[str, str] = Field(default_factory=dict)
    cmd: list[str] = Field(default_factory=list)
    cpu_limit: Optional[str] = None
    memory_limit: Optional[str] = None


class SpawnSpec(_Strict):
    """
    A per-session supergateway instance, docker-exec'd inside an already-running
    *shared* container. One of these backs exactly one external MCP session, so
    supergateway's single-session-per-process limit stops being a collision
    between unrelated clients — each client gets its own process instead of
    fighting over the one the container started with.
    """
    inner: str        # the stdio command supergateway wraps (socat relay, or bare npx/uvx)
    listen_port: int  # dedicated port for this session's supergateway instance
    env: dict[str, str] = Field(default_factory=dict)


# ── stdio relay ───────────────────────────────────────────────────────────────

_stdio_sessions: dict[int, dict] = {}


async def _serve_stdio(port: int, spec: StdioSpec) -> None:
    """
    Accept a TCP connection and wire it to a fresh `docker run -i <image>`.

    This is the piece that lets the runner drop the Docker socket: supergateway
    still gets a process on the other end of a pipe, but the process — and the
    socket — live here.
    """
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        peer = writer.get_extra_info("peername")
        logger.info(f"stdio[{port}] connection from {peer} -> docker run {spec.image}")

        argv = [
            "docker", "run", "--rm", "-i",
            "--network", MCPLAMA_NETWORK,
            *_hardening(spec.cpu_limit, spec.memory_limit),
            *_env_args(spec.env),
            spec.image,
            *spec.cmd,
        ]
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        async def pump_in():
            try:
                while data := await reader.read(65536):
                    proc.stdin.write(data)
                    await proc.stdin.drain()
            except Exception:
                pass
            finally:
                if proc.stdin and not proc.stdin.is_closing():
                    proc.stdin.close()

        async def pump_out():
            try:
                while data := await proc.stdout.read(65536):
                    writer.write(data)
                    await writer.drain()
            except Exception:
                pass
            finally:
                try:
                    writer.close()
                except Exception:
                    pass

        async def drain_err():
            try:
                while line := await proc.stderr.readline():
                    text = line.decode(errors='replace').rstrip()
                    session = _stdio_sessions.get(port)
                    if session is not None:
                        session.setdefault("logs", []).append(text)
                        session["logs"] = session["logs"][-200:]
                    logger.info(f"stdio[{port}] {spec.image}: {text}")
            except Exception:
                pass

        try:
            await asyncio.gather(pump_in(), pump_out(), drain_err())
        finally:
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            logger.info(f"stdio[{port}] session closed (exit={proc.returncode})")

    server = await asyncio.start_server(handle, "0.0.0.0", port)
    _stdio_sessions[port]["server"] = server
    async with server:
        await server.serve_forever()


# ── API ───────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    code, _, _ = await _run(["docker", "info"])
    return {"status": "ok", "docker_available": code == 0}


@app.get("/docker/info")
async def docker_info(x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    code, _, _ = await _run(["docker", "info"])
    _, images, _ = await _run(["docker", "images", "--format", "{{.Repository}}:{{.Tag}}"])
    _, names, _ = await _run(["docker", "ps", "--format", "{{.Names}}"])
    return {
        "docker_available": code == 0,
        "images": images.splitlines() if images else [],
        "running_containers": names.splitlines() if names else [],
    }


@app.post("/images/pull")
async def pull_image(spec: PullSpec, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    await _pull(spec.image)
    return {"pulled": spec.image}


@app.post("/images/remove")
async def remove_image(spec: PullSpec, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    if spec.image == RUNNER_IMAGE:
        raise HTTPException(400, "Refusing to remove the shared runner image")
    code, out, err = await _run(["docker", "rmi", spec.image])
    return {"removed": code == 0, "error": None if code == 0 else (err or out)}


@app.get("/containers")
async def list_containers(x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    code, out, _ = await _run([
        "docker", "ps", "--filter", "label=mcplama=true", "--format", "{{json .}}"
    ])
    if code != 0 or not out:
        return []
    result = []
    for line in out.splitlines():
        try:
            result.append(json.loads(line))
        except Exception:
            pass
    return result


@app.get("/containers/{name}")
async def container_status(name: str, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    code, out, _ = await _run(["docker", "ps", "-q", "--filter", f"name=^{name}$"])
    cid = out.strip() if code == 0 else ""
    if not cid:
        raise HTTPException(404, "not running")
    return {"id": cid}


@app.get("/containers/{name}/logs")
async def container_logs(name: str, tail: int = 200, x_broker_token: str = Header(None)):
    """docker logs of the container's own entrypoint process — only
    meaningful for a non-multiplexed container, whose entrypoint IS the
    npx/uvx/docker MCP process. A shared/multiplexed container's entrypoint
    is just a keepalive shell; see /containers/{name}/spawn/{listen_port}/logs
    for that case."""
    _auth(x_broker_token)
    # docker logs delivers stdout/stderr as two separate streams (`_run`
    # captures them into separate pipes) — a crash traceback almost always
    # lands on stderr while supergateway's own banner lines go to stdout, so
    # returning whichever one is merely non-empty silently drops the other.
    code, out, err = await _run(["docker", "logs", "--tail", str(max(1, min(tail, 2000))), name])
    return {"logs": (out + "\n" + err) if out and err else (out or err)}


@app.get("/containers/{name}/spawn/{listen_port}/logs")
async def spawn_session_logs(name: str, listen_port: int, tail: int = 200, x_broker_token: str = Header(None)):
    """stdout/stderr of one docker-exec'd session (see spawn_session), which
    redirects to /tmp/sg-{listen_port}.log inside the container instead of
    the container's own `docker logs` stream."""
    _auth(x_broker_token)
    code, out, err = await _run([
        "docker", "exec", name, "sh", "-c",
        f"tail -n {max(1, min(tail, 2000))} /tmp/sg-{listen_port}.log 2>/dev/null || true",
    ])
    return {"logs": out}


async def _running_id(name: str) -> str:
    code, out, _ = await _run(["docker", "ps", "-q", "--filter", f"name=^{name}$"])
    return out.strip() if code == 0 else ""


# One lock per container name. Two clients can race to start the same server
# (e.g. a cold-start `initialize` and the startup reconciler), and `docker rm -f`
# → `docker run` is not atomic — the loser used to get a "Conflict" 500. The lock
# serialises same-name starts so the second caller sees the winner's container.
_start_locks: dict[str, asyncio.Lock] = {}


@app.post("/containers")
async def start_container(spec: StartSpec, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    await _ensure_network()
    await _pull(spec.image)

    lock = _start_locks.setdefault(spec.name, asyncio.Lock())
    async with lock:
        # Someone may have won the race while we waited for the lock.
        existing = await _running_id(spec.name)
        if existing:
            logger.info(f"{spec.name} already running ({existing[:12]}) — reusing")
            return {"id": existing, "name": spec.name}

        # Replace any dead container of the same name.
        await _run(["docker", "rm", "-f", spec.name])

        labels = []
        for k, v in spec.labels.items():
            labels.extend(["--label", f"{k}={v}"])

        # The argv is assembled HERE, from typed fields. Nothing the caller sends
        # can introduce a flag: env becomes -e pairs, cmd/shell land after image.
        argv = [
            "docker", "run", "-d",
            "--name", spec.name,
            "--network", MCPLAMA_NETWORK,
            *_hardening(spec.cpu_limit, spec.memory_limit),
            *labels,
            *_env_args(spec.env),
            spec.image,
        ]
        if spec.shell is not None:
            argv += ["sh", "-c", spec.shell]
        else:
            argv += spec.cmd

        code, out, err = await _run(argv)

        # Belt and suspenders: if the daemon still reports a name conflict
        # (a rm/run interleave the lock can't cover, e.g. two broker processes),
        # treat an already-running container as success rather than a 500.
        if code != 0 and "already in use" in (err or "").lower():
            existing = await _running_id(spec.name)
            if existing:
                return {"id": existing, "name": spec.name}
    if code != 0:
        docker_error = err or out
        cpu_match = re.search(r"range of CPUs is from [^,]+, as there are only ([0-9.]+) CPUs available", docker_error)
        memory_match = re.search(r"Minimum memory limit allowed is ([0-9.]+[bkmg]?)", docker_error, re.IGNORECASE)
        if cpu_match:
            available = cpu_match.group(1)
            raise HTTPException(
                500,
                f"Failed to start {spec.name}: this server's CPU limit is too high for the host. "
                f"The host currently has {available} CPU(s) available. Edit the server and set "
                f"CPU limit to {available} or less (for example 1), then save and retry."
            )
        if "memory" in docker_error.lower() and memory_match:
            minimum = memory_match.group(1)
            raise HTTPException(
                500,
                f"Failed to start {spec.name}: this server's memory limit is too high for the host. "
                f"Docker requires at least {minimum}. Edit the server and lower its memory limit, "
                f"for example to 256m, then save and retry."
            )
        raise HTTPException(500, f"Failed to start {spec.name}: {docker_error}")
    logger.info(f"started {spec.name} ({out[:12]})")
    return {"id": out, "name": spec.name}


@app.delete("/containers/{name}")
async def remove_container(name: str, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    code, _, err = await _run(["docker", "rm", "-f", name])
    return {"removed": code == 0, "error": err or None}


@app.post("/sweep-image")
async def sweep_image(spec: SweepSpec, x_broker_token: str = Header(None)):
    """
    Remove every mcplama-labeled container using the given image.

    Session-multiplexed servers back each client session with its own
    standalone `docker run` of the underlying MCP image (see
    container_manager.open_session) — there is no other reason such a
    container would exist on this network. A backend restart forgets which
    ones it started (in-memory tracking only), so on boot the backend calls
    this for each session-multiplexed server's image to clear out whatever
    a previous life left running, rather than leaking one container per
    session forever.
    """
    _auth(x_broker_token)
    code, out, _ = await _run([
        "docker", "ps", "-aq", "--filter", f"ancestor={spec.image}", "--filter", "label=mcplama=true",
    ])
    ids = out.splitlines() if code == 0 and out else []
    for cid in ids:
        await _run(["docker", "rm", "-f", cid])
    return {"removed": len(ids)}


@app.post("/stdio-sessions")
async def create_stdio_session(spec: StdioSpec, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    await _ensure_network()
    await _pull(spec.image)

    for port in range(STDIO_PORT_MIN, STDIO_PORT_MAX + 1):
        if port not in _stdio_sessions:
            break
    else:
        raise HTTPException(503, "No free stdio relay ports")

    _stdio_sessions[port] = {"image": spec.image, "server": None, "logs": []}
    asyncio.create_task(_serve_stdio(port, spec))
    await asyncio.sleep(0.1)  # let the listener bind before the runner dials in
    logger.info(f"stdio session for {spec.image} listening on :{port}")
    return {"port": port}


@app.delete("/stdio-sessions/{port}")
async def close_stdio_session(port: int, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    session = _stdio_sessions.pop(port, None)
    if session and session.get("server"):
        session["server"].close()
    return {"closed": bool(session)}


@app.get("/stdio-sessions/{port}/logs")
async def stdio_session_logs(port: int, tail: int = 200, x_broker_token: str = Header(None)):
    """Return recent stderr from the Docker process backing a stdio relay."""
    _auth(x_broker_token)
    session = _stdio_sessions.get(port)
    if not session:
        raise HTTPException(404, "stdio session not found")
    lines = session.get("logs", [])[-max(1, min(tail, 200)):]
    return {"logs": "\n".join(lines)}


# ── Per-session supergateway spawn (shared containers) ─────────────────────────
#
# A shared container's own entrypoint is just a keepalive (see
# container_manager._sg_cmd usage) — it holds no supergateway of its own. Each
# real client session gets its own supergateway instance, docker-exec'd into
# that already-running container on a dedicated port, so the "one live session
# per process" limit of supergateway/MCP stdio servers stops meaning "one live
# session for the whole shared container."
_spawned: dict[tuple[str, int], bool] = {}


@app.post("/containers/{name}/spawn")
async def spawn_session(name: str, spec: SpawnSpec, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    if not await _running_id(name):
        raise HTTPException(404, f"Container {name} is not running")
    # Broker state is in memory, so a broker restart can forget a still-running
    # docker-exec'd supergateway from its previous lifetime. Remove only the
    # exact listener this request is about before reusing the port; otherwise
    # the new process fails with EADDRINUSE and the client sees a misleading
    # tools/list HTTP 400.
    await _run(["docker", "exec", name, "pkill", "-f", f"--port {spec.listen_port} "])
    cmd = (
        f"npx -y supergateway --stdio {spec.inner} "
        f"--port {spec.listen_port} --outputTransport streamableHttp --stateful --logLevel debug "
        f"> /tmp/sg-{spec.listen_port}.log 2>&1"
    )
    code, out, err = await _run(["docker", "exec", "-d", *_env_args(spec.env), name, "sh", "-c", cmd])
    if code != 0:
        raise HTTPException(500, f"Failed to spawn session on {name}:{spec.listen_port}: {err or out}")
    _spawned[(name, spec.listen_port)] = True
    logger.info(f"Spawned session supergateway on {name}:{spec.listen_port}")
    return {"listen_port": spec.listen_port}


@app.delete("/containers/{name}/spawn/{listen_port}")
async def kill_session(name: str, listen_port: int, x_broker_token: str = Header(None)):
    _auth(x_broker_token)
    # Match on the exact --port value in argv so this only ever kills the one
    # supergateway instance it names, never a sibling session on the same container.
    await _run(["docker", "exec", name, "pkill", "-f", f"--port {listen_port} "])
    _spawned.pop((name, listen_port), None)
    return {"killed": True}
