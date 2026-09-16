# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
stdio ↔ HTTP Bridge
-------------------
Handles both MCP transport versions:

Streamable HTTP (2024-11-05+):
  POST /mcp  → send message, get response
  GET  /mcp  → optional SSE for server push

SSE transport (older):
  POST /mcp           → initialize, returns Mcp-Session-Id header
  GET  /mcp?sessionId → open SSE stream
  POST /mcp?sessionId → send messages

We detect which transport the server uses from the POST response headers
and handle session ID forwarding automatically.
"""
import asyncio
import httpx
import logging
from typing import AsyncGenerator

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(120.0, connect=10.0)
CONTAINER_PORT = 8000

# Session ID headers to look for (different servers use different names)
SESSION_HEADERS = ["mcp-session-id", "x-session-id", "x-mcp-session-id"]

# In-memory session store: "container_name:port" → session_id. Keyed by port
# as well as name because a shared container can host several concurrent
# per-session supergateway instances (one per port) — keying by name alone
# would let one session's ID leak into another's requests.
_sessions: dict[str, str] = {}


def session_key(container_name: str, port: int) -> str:
    return f"{container_name}:{port}"


# External MCP session ID (the one we hand back to the real client) →
# (container_name, listen_port) of the dedicated per-session supergateway
# instance backing it. Lets connect.py route a client's follow-up requests
# back to the same session-scoped instance that handled its initialize.
_session_routes: dict[str, tuple[str, int]] = {}


def route_session(session_id: str) -> "tuple[str, int] | None":
    return _session_routes.get(session_id)


def set_session_route(session_id: str, container_name: str, port: int):
    _session_routes[session_id] = (container_name, port)


def pop_session_route(session_id: str) -> "tuple[str, int] | None":
    return _session_routes.pop(session_id, None)


def _container_url(container_name: str, path: str = "/", port: int = CONTAINER_PORT) -> str:
    path = path or "/"
    if not path.startswith("/"):
        path = "/" + path
    return f"http://{container_name}:{port}{path}"


def _inject_session(params: dict, container_name: str, port: int) -> dict:
    """Add sessionId to params if we have one stored for this container:port."""
    session_id = _sessions.get(session_key(container_name, port))
    if session_id and "sessionId" not in params:
        return {**params, "sessionId": session_id}
    return params


# container:port → set of env-var names already warned about, so a chatty
# client hammering the same broken tool doesn't spam the app log forever.
_warned_missing_env: dict[str, set[str]] = {}


def _check_tools_call_error(container_name: str, port: int, request_body: bytes, response_bytes: bytes) -> None:
    """
    A tools/call that fails because the server needed a credential it never
    got (e.g. GITHUB_TOKEN) still comes back as a normal 200 JSON-RPC
    response with result.isError=true — no HTTP error, no top-level
    JSON-RPC error. That makes it structurally invisible to everything else
    in this module, which only ever looks at status codes and session
    headers. This is the one place that sees the actual response body, so
    it's the only place that can leave a trail for it at all.
    """
    import json
    try:
        if json.loads(request_body).get("method") != "tools/call":
            return
    except Exception:
        return

    text = response_bytes.decode(errors="replace")
    if "data:" in text:
        for line in text.splitlines():
            if line.startswith("data:"):
                text = line[len("data:"):].strip()
                break
    try:
        data = json.loads(text)
    except Exception:
        return

    result = data.get("result") or {}
    if not result.get("isError"):
        return

    content = result.get("content") or []
    message = " ".join(c.get("text", "") for c in content if isinstance(c, dict)) or str(result)

    from app.services.binary_detect import detect_missing_env_var
    missing_var = detect_missing_env_var(message)
    if not missing_var:
        return

    key = session_key(container_name, port)
    warned = _warned_missing_env.setdefault(key, set())
    if missing_var in warned:
        return
    warned.add(missing_var)
    logger.warning(
        f"tools/call on {container_name}:{port} failed — server appears to be "
        f"missing '{missing_var}' (isError text: {message[:200]!r})"
    )


def _is_initialize(body: bytes) -> bool:
    """
    A fresh `initialize` call must never carry a previously stored session —
    the server assigns the session on init. If we stamp an old session onto
    it anyway (e.g. a second client opening the same per-user connection),
    a --stateful supergateway routes it to the already-initialized transport
    for that session and rejects it with "Server already initialized",
    which is exactly the "blocked on init" hang this guards against.
    """
    if not body:
        return False
    try:
        import json
        return json.loads(body).get("method") == "initialize"
    except Exception:
        return False


def _extract_session(container_name: str, port: int, headers: dict):
    """
    Extract and store session ID from response headers, and mirror it into
    _session_routes — the external session ID a client sees is exactly what
    connect.py needs to route that client's later requests back to this same
    (container_name, port) instance, and this is the one place that always
    sees a session ID the moment it's assigned, streaming or not.
    """
    key = session_key(container_name, port)
    for h in SESSION_HEADERS:
        val = headers.get(h) or headers.get(h.title())
        if val:
            _sessions[key] = val
            set_session_route(val, container_name, port)
            logger.info(f"Session ID stored for {key}: {val[:16]}...")
            return
    # Also check for sessionId in response body header format
    session = headers.get("mcp-session-id") or headers.get("Mcp-Session-Id")
    if session:
        _sessions[key] = session
        set_session_route(session, container_name, port)


async def forward_request(
    container_name: str,
    method: str,
    path: str,
    headers: dict,
    body: bytes,
    params: dict,
    port: int = CONTAINER_PORT,
) -> tuple[int, dict, bytes]:
    url = _container_url(container_name, path, port)
    skip = {"host", "content-length", "transfer-encoding", "connection"}
    fwd = {k: v for k, v in headers.items() if k.lower() not in skip}

    # Inject session ID if we have one
    params = _inject_session(params, container_name, port)

    # Add stored session ID as header too (some servers prefer header)
    session_id = _sessions.get(session_key(container_name, port))
    if session_id:
        fwd["mcp-session-id"] = session_id

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.request(
                method=method, url=url, headers=fwd,
                content=body or None, params=params,
            )
            content = resp.content
            logger.info(f"{method} {url} → {resp.status_code} headers={dict(resp.headers)} body={content[:300]!r}")

            # Extract session ID from response for future requests
            _extract_session(container_name, port, dict(resp.headers))

            return resp.status_code, dict(resp.headers), content
    except httpx.ConnectError as e:
        raise RuntimeError(f"Cannot connect to container {container_name}: {e}")
    except httpx.TimeoutException:
        raise TimeoutError(f"Container {container_name} timed out")


async def open_post_stream(
    container_name: str,
    path: str,
    headers: dict,
    body: bytes,
    params: dict,
    port: int = CONTAINER_PORT,
) -> tuple[dict, AsyncGenerator[bytes, None]]:
    """
    Like stream_post, but returns (response_headers, body_generator) instead
    of just streaming the body. A plain StreamingResponse fixes its headers
    before its body generator ever runs, so Mcp-Session-Id — only known once
    the upstream response actually arrives — can never be added afterward.
    Session-multiplexed callers need that header to reach the client, or the
    client can never send it back to reach the same per-session instance
    again. Used only where that matters; stream_post is untouched elsewhere.
    """
    url = _container_url(container_name, path, port)
    skip = {"host", "content-length", "transfer-encoding", "connection"}
    fwd = {k: v for k, v in headers.items() if k.lower() not in skip}
    if _is_initialize(body):
        params = {k: v for k, v in params.items() if k != "sessionId"}
    else:
        params = _inject_session(params, container_name, port)
        session_id = _sessions.get(session_key(container_name, port))
        if session_id:
            fwd["mcp-session-id"] = session_id

    client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    stream_cm = client.stream("POST", url, headers=fwd, content=body or None, params=params)
    try:
        resp = await stream_cm.__aenter__()
    except Exception:
        await client.aclose()
        raise

    logger.info(f"POST stream {url} → {resp.status_code} headers={dict(resp.headers)}")
    _extract_session(container_name, port, dict(resp.headers))
    resp_headers = dict(resp.headers)
    status = resp.status_code

    async def body_gen():
        chunks = []
        try:
            if status >= 400:
                err = await resp.aread()
                logger.error(f"stream_post {status}: {err[:200]}")
                yield f"event: error\ndata: {err.decode(errors='replace')}\n\n".encode()
                return
            async for chunk in resp.aiter_bytes(512):
                if chunk:
                    chunks.append(chunk)
                    yield chunk
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"stream_post error for {container_name}: {e}")
            yield f"event: error\ndata: {str(e)}\n\n".encode()
        finally:
            await stream_cm.__aexit__(None, None, None)
            await client.aclose()
            if chunks:
                _check_tools_call_error(container_name, port, body, b"".join(chunks))

    return resp_headers, body_gen()


async def stream_post(
    container_name: str,
    path: str,
    headers: dict,
    body: bytes,
    params: dict,
    port: int = CONTAINER_PORT,
) -> AsyncGenerator[bytes, None]:
    url = _container_url(container_name, path, port)
    skip = {"host", "content-length", "transfer-encoding", "connection"}
    fwd = {k: v for k, v in headers.items() if k.lower() not in skip}
    if _is_initialize(body):
        params = {k: v for k, v in params.items() if k != "sessionId"}
    else:
        params = _inject_session(params, container_name, port)
        session_id = _sessions.get(session_key(container_name, port))
        if session_id:
            fwd["mcp-session-id"] = session_id
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            stale = False
            async with client.stream("POST", url, headers=fwd, content=body or None, params=params) as resp:
                logger.info(f"POST stream {url} → {resp.status_code} headers={dict(resp.headers)}")
                _extract_session(container_name, port, dict(resp.headers))
                if resp.status_code >= 400:
                    err = await resp.aread()
                    err_text = err.decode(errors="replace")
                    if resp.status_code == 400 and "session" in err_text.lower():
                        stale = True
                    else:
                        logger.error(f"stream_post {resp.status_code}: {err_text[:200]}")
                        yield f"event: error\ndata: {err_text}\n\n".encode()
                        return
                else:
                    chunks = []
                    async for chunk in resp.aiter_bytes(512):
                        if chunk:
                            logger.info(f"stream_post chunk: {chunk[:100]!r}")
                            chunks.append(chunk)
                            yield chunk
                    if chunks:
                        _check_tools_call_error(container_name, port, body, b"".join(chunks))
                    return

            # No valid session for this request — this covers both a
            # locally-cached session going stale AND the case where we never
            # had one cached at all but the downstream server (a long-lived
            # runner container our own process restart didn't touch) still
            # requires one. Either way the fix is the same: mint a fresh
            # session via our own initialize call, then retry the caller's
            # original request (not just re-send it — a bare tools/call
            # replayed without a session fails the same way) with that
            # session attached.
            _sessions.pop(session_key(container_name, port), None)
            logger.warning(f"Stale/missing session for {container_name}:{port}, re-initializing and retrying")
            new_session = await _reinitialize(client, container_name, path, port)
            if not new_session:
                yield b'event: error\ndata: {"error":"session recovery failed"}\n\n'
                return
            retry_headers = {k: v for k, v in fwd.items() if k.lower() != "mcp-session-id"}
            retry_headers["mcp-session-id"] = new_session
            retry_params = {k: v for k, v in params.items() if k != "sessionId"}
            async with client.stream("POST", url, headers=retry_headers, content=body or None, params=retry_params) as resp2:
                logger.info(f"POST stream retry {url} → {resp2.status_code}")
                _extract_session(container_name, port, dict(resp2.headers))
                if resp2.status_code >= 400:
                    err2 = await resp2.aread()
                    logger.error(f"stream_post retry {resp2.status_code}: {err2[:200]}")
                    yield f"event: error\ndata: {err2.decode(errors='replace')}\n\n".encode()
                    return
                retry_chunks = []
                async for chunk in resp2.aiter_bytes(512):
                    if chunk:
                        logger.info(f"stream_post chunk: {chunk[:100]!r}")
                        retry_chunks.append(chunk)
                        yield chunk
                if retry_chunks:
                    _check_tools_call_error(container_name, port, body, b"".join(retry_chunks))
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.warning(f"stream_post error for {container_name}: {e}")
        yield f"event: error\ndata: {str(e)}\n\n".encode()


async def _reinitialize(client: httpx.AsyncClient, container_name: str, path: str, port: int) -> str | None:
    """Mint a fresh MCP session against an already-running server and cache it."""
    import json
    url = _container_url(container_name, path, port)
    init_body = json.dumps({
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "mcplama-recover", "version": "1.0.0"},
        },
        "id": 999000002,
    }).encode()
    try:
        resp = await client.post(
            url, content=init_body,
            headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        )
        session_id = resp.headers.get("mcp-session-id") or resp.headers.get("Mcp-Session-Id")
        if resp.status_code == 200 and session_id:
            _sessions[session_key(container_name, port)] = session_id
            logger.info(f"Re-initialized session for {container_name}:{port}: {session_id[:16]}...")
            return session_id
        logger.warning(f"Re-initialize returned {resp.status_code} (session={bool(session_id)}) for {container_name}:{port}")
    except Exception as e:
        logger.warning(f"Re-initialize error for {container_name}: {e}")
    return None


async def stream_sse(
    container_name: str,
    path: str,
    headers: dict,
    params: dict,
    port: int = CONTAINER_PORT,
    proxy_base_url: str = "",
) -> AsyncGenerator[bytes, None]:
    url = _container_url(container_name, path, port)
    skip = {"host", "content-length", "transfer-encoding", "connection", "accept"}
    fwd = {k: v for k, v in headers.items() if k.lower() not in skip}
    fwd["Accept"] = "text/event-stream"
    fwd["Cache-Control"] = "no-cache"

    session_id = _sessions.get(session_key(container_name, port))
    if session_id:
        params = _inject_session(params, container_name, port)
        fwd["mcp-session-id"] = session_id

    logger.info(f"SSE GET {url} params={params} session={session_id and session_id[:16] if session_id else None}")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            async with client.stream("GET", url, headers=fwd, params=params) as resp:
                logger.info(f"SSE stream: {resp.status_code}")
                if resp.status_code == 400:
                    body = await resp.aread()
                    body_text = body.decode()
                    if "session" in body_text.lower() and session_key(container_name, port) in _sessions:
                        # Stale session — clear and retry without session ID
                        logger.warning(f"Stale session for {container_name}:{port}, clearing and retrying")
                        del _sessions[session_key(container_name, port)]
                        clean_params = {k: v for k, v in params.items() if k != "sessionId"}
                        clean_headers = {k: v for k, v in fwd.items() if k.lower() != "mcp-session-id"}
                        async with client.stream("GET", url, headers=clean_headers, params=clean_params) as resp2:
                            logger.info(f"SSE retry stream: {resp2.status_code}")
                            if resp2.status_code >= 400:
                                body2 = await resp2.aread()
                                logger.error(f"SSE retry error {resp2.status_code}: {body2.decode()[:200]}")
                                yield f"event: error\ndata: {body2.decode()}\n\n".encode()
                                return
                            resp = resp2
                    else:
                        logger.error(f"SSE error {resp.status_code}: {body_text[:200]}")
                        yield f"event: error\ndata: {body_text}\n\n".encode()
                        return
                elif resp.status_code >= 400:
                    body = await resp.aread()
                    logger.error(f"SSE error {resp.status_code}: {body.decode()[:200]}")
                    yield f"event: error\ndata: {body.decode()}\n\n".encode()
                    return
                buffer = b""
                async for chunk in resp.aiter_bytes(512):
                    if not chunk:
                        continue
                    buffer += chunk
                    # Process complete SSE events (delimited by double newline)
                    while b"\n\n" in buffer:
                        event, buffer = buffer.split(b"\n\n", 1)
                        event_str = event.decode("utf-8", errors="replace")
                        # Rewrite endpoint data line to point through MCPlama
                        if proxy_base_url and "data:" in event_str:
                            new_lines = []
                            for l in event_str.split("\n"):
                                if l.startswith("data:"):
                                    data = l[5:].strip()
                                    if "/message" in data:
                                        l = f"data: {proxy_base_url}"
                                        logger.info(f"Rewrote endpoint: {data} → {proxy_base_url}")
                                new_lines.append(l)
                            event_str = "\n".join(new_lines)
                        logger.info(f"SSE event to client: {event_str[:200]!r}")
                        yield event_str.encode() + b"\n\n"
                if buffer:
                    yield buffer
        while True:
            await asyncio.sleep(15)
            yield b": keepalive\n\n"
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.warning(f"SSE error for {container_name}: {e}")
        yield f"event: error\ndata: {str(e)}\n\n".encode()


async def wait_for_container(
    container_name: str,
    timeout: int = 30,
    port: int = CONTAINER_PORT,
    mcp_path: str = "/mcp",
    skip_preinit: bool = False,
) -> bool:
    """
    Wait until container is up, then pre-initialize to get session ID.

    skip_preinit=True skips the extra handshake below. Use it when the caller
    is about to send its own real initialize immediately after — on a
    docker+stdio backed server (e.g. mcp/playwright) each unsessioned
    initialize costs a brand-new `docker run` (the broker/supergateway combo
    has no session to reuse, see stdio_bridge module docstring and
    broker/main.py._serve_stdio), so doing the handshake twice in a row
    doubles that cost for nothing — the caller's own request already proves
    readiness.
    """
    # Step 1 — wait for HTTP server to respond
    url = _container_url(container_name, "/", port)
    for _ in range(timeout):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(2.0)) as client:
                resp = await client.get(url)
                logger.info(f"Container {container_name} up (status={resp.status_code})")
                break
        except httpx.ConnectError:
            await asyncio.sleep(1)
        except Exception:
            break
    else:
        return False

    if skip_preinit:
        return True

    # Step 2 — send initialize POST to get session ID
    await _pre_initialize(container_name, port, mcp_path)
    return True


async def _pre_initialize(container_name: str, port: int, mcp_path: str = "/mcp"):
    """
    Pre-initialize to verify server is ready.
    For /mcp (Streamable HTTP): POST initialize → get session ID → DELETE session
    For /sse (supergateway SSE): just check the endpoint responds
    """
    # SSE transport (supergateway) — just verify port is open, don't connect
    if mcp_path == "/sse":
        logger.info(f"Container {container_name} uses SSE transport — skipping pre-init")
        return

    # Streamable HTTP pre-init (POST initialize → get session → DELETE)
    import json
    url = _container_url(container_name, mcp_path, port)
    body = json.dumps({
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "mcplama-healthcheck", "version": "1.0.0"}
        },
        # Deliberately not 1 — a real caller's initialize (test_connection,
        # or the actual MCP client) lands moments after this on the same
        # "stateless" supergateway bridge. If both use id=1, a slow-starting
        # `npx -y <pkg>` child that responds after this call's own timeout
        # has already given up leaves supergateway's request→connection map
        # holding a dead entry for id 1; the next request that reuses id 1
        # then crashes the whole Node process ("No connection established
        # for request ID: 1"), which surfaces here as a generic transport
        # error on that *next* call.
        "id": 999000001
    }).encode()

    try:
        # A cold `npx -y <package>`/`uvx <package>` install can easily take
        # longer than the old 10s (then 25s) budget before the child process
        # is ready to respond — a uvx package pulling in a few binary wheels
        # (cryptography, pydantic-core, ...) with no cache yet has been
        # observed taking close to a minute. Give it real room before we give
        # up and leave a dangling request.
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            resp = await client.post(
                url, content=body,
                headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
            )
            logger.info(f"Pre-init {container_name}: {resp.status_code} headers={dict(resp.headers)}")
            if resp.status_code == 200:
                session_id = resp.headers.get("mcp-session-id") or resp.headers.get("Mcp-Session-Id")
                if session_id:
                    logger.info(f"Server ready, cancelling health-check session {session_id[:16]}...")
                    await client.delete(url, headers={"mcp-session-id": session_id})
                    logger.info(f"Container {container_name} is ready (session cancelled)")
                else:
                    logger.info(f"Container {container_name} is ready (no session)")
            else:
                logger.warning(f"Pre-init returned {resp.status_code} for {container_name}")
    except Exception as e:
        logger.warning(f"Pre-init failed for {container_name}: {e}")


def clear_session(container_name: str):
    """
    Clear stored session(s) for a container (call on container/session restart).

    Accepts either a bare container name — clearing every session cached for
    it, across all ports, since the whole container is going away — or an
    exact "name:port" key for a single per-session instance.
    """
    _sessions.pop(container_name, None)
    prefix = f"{container_name}:"
    for key in [k for k in _sessions if k.startswith(prefix)]:
        _sessions.pop(key, None)