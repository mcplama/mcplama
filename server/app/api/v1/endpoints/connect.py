# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
/connect/{token} — MCP proxy endpoint.
"""
import asyncio
import hashlib
import time
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.core.config import settings
from app.models.connection import Connection
from app.models.connection_access_token import ConnectionAccessToken
from app.models.server import Server, Runtime, AuthMode
from app.models.audit import AuditLog
from app.services import container_manager as cm
from app.services import stdio_bridge as bridge
from app.services.token_store import get_token
from app.core.encryption import decrypt_dict, decrypt
from app.core.ssrf import validate_remote_url

import logging
logger = logging.getLogger(__name__)

# Per-(server_id, user_id) MCP session ID store for remote servers
# Notion and other stateful MCP servers require this on every request
_remote_sessions: dict[str, str] = {}  # key: "server_id:user_id" -> session_id

router = APIRouter(prefix="/connect", tags=["connect"])


def _validate_origin(request: Request) -> None:
    """
    Reject cross-origin browser requests (MCP Streamable HTTP spec: servers MUST
    validate Origin to prevent DNS-rebinding attacks).

    Native MCP clients (Claude Desktop, VS Code, CLI tools) send no Origin header
    at all — only browsers do — so an absent Origin is allowed. A *present*
    Origin must be one we trust.
    """
    origin = request.headers.get("origin")
    if not origin:
        return

    allowed = {o.rstrip("/") for o in settings.cors_list if o}
    allowed.add(settings.GATEWAY_URL.rstrip("/"))
    allowed.add(settings.FRONTEND_URL.rstrip("/"))

    if origin.rstrip("/") not in allowed:
        logger.warning(f"Rejected /connect request with untrusted Origin: {origin!r}")
        raise HTTPException(403, "Origin not allowed")


def _unauthorized(token: str, error: str, description: str) -> "JSONResponse":
    """
    401 challenge pointing the client at our protected-resource metadata.

    RFC 9728 §5.1 (which the MCP authorization spec builds on) names the
    parameter `resource_metadata` and expects a URL to the metadata document —
    not the resource URL itself. `resource`/`as` are kept alongside it only so
    that clients written against the previous, non-standard shape keep working.
    """
    from fastapi.responses import JSONResponse

    base = settings.GATEWAY_URL.rstrip("/")
    resource = f"{base}/connect/{token}" if token else base
    metadata_url = (
        f"{base}/.well-known/oauth-protected-resource/connect/{token}"
        if token
        else f"{base}/.well-known/oauth-protected-resource"
    )

    challenge = (
        f'Bearer realm="{base}", '
        f'resource_metadata="{metadata_url}", '
        f'resource="{resource}", as="{base}"'
    )
    if error != "unauthorized":
        challenge += f', error="{error}"'

    return JSONResponse(
        status_code=401,
        content={"error": error, "error_description": description},
        headers={
            "WWW-Authenticate": challenge,
            "Access-Control-Expose-Headers": "WWW-Authenticate",
        },
    )


def _extract_token(token_path: str, request: Request) -> str:
    if token_path:
        return token_path
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth.removeprefix("Bearer ").strip()
    return ""


async def _resolve_by_access_token(bearer_token: str):
    """
    Resolve a connection via a rotated access token minted by
    mcp_auth.py:/token after a client completes the login-gated OAuth
    exchange. Deliberately NOT a lookup against the raw Connection.token
    embedded in the /connect/{token} URL — knowing that URL proves nothing
    beyond having seen the URL, so it can't be what grants proxy access.
    """
    async with AsyncSessionLocal() as db:
        cr = await db.execute(
            select(ConnectionAccessToken).where(ConnectionAccessToken.token == bearer_token)
        )
        at = cr.scalar_one_or_none()
        if not at:
            return None, None
        if at.expires_at and at.expires_at < datetime.utcnow():
            return None, None
        cr2 = await db.execute(
            select(Connection).where(Connection.id == at.connection_id, Connection.is_active == True)
        )
        conn = cr2.scalar_one_or_none()
        if not conn:
            return None, None
        if conn.expires_at and conn.expires_at < datetime.utcnow():
            return None, None
        sr = await db.execute(
            select(Server).where(Server.id == conn.server_id, Server.is_enabled == True)
        )
        return conn, sr.scalar_one_or_none()


async def _build_env(server: Server, conn) -> dict:
    env = {}
    if server.auth_mode == AuthMode.shared:
        cfg = decrypt_dict(server.auth_config or {}, context_prefix=f"server:{server.id}:auth_config")
        env.update({k: v for k, v in cfg.items() if v})
    elif server.auth_mode == AuthMode.per_user:
        async with AsyncSessionLocal() as db:
            stored = await get_token(db, server.id, conn.user_id)
        if stored and stored.access_token:
            schema = server.user_config_schema or []
            key = schema[0].get("key", "API_TOKEN") if schema else "API_TOKEN"
            env[key] = stored.access_token
    return env


def _jsonrpc_denied(body: bytes, message: str) -> Response:
    """
    Build the client-facing response for a policy-denied call.

    A blocked tools/call is a *tool* outcome, not a transport failure. Returning
    HTTP 403 makes MCP clients surface it as a broken connection; a JSON-RPC
    error object over HTTP 200 lets them render it as a failed tool call and
    keep the session alive.
    """
    import json as _json
    req_id = None
    try:
        parsed = _json.loads(body)
        if isinstance(parsed, dict):
            req_id = parsed.get("id")
    except Exception:
        pass

    # A JSON-RPC notification (no id) takes no response body — the Streamable
    # HTTP spec wants a bare 202 here.
    if req_id is None:
        return Response(status_code=202)

    return Response(
        content=_json.dumps({
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32000,
                "message": message,
                "data": {"code": "POLICY_VIOLATION"},
            },
        }).encode(),
        status_code=200,
        media_type="application/json",
    )


_POLICY_DENIED_MSG = (
    "Access blocked by your administrator. Contact your admin for more information."
)


async def _check_policies(conn, server, request, body) -> tuple[Response | None, bytes]:
    """
    Evaluate policies for this call.

    Returns (None, body) if the call is allowed — body is the original body,
    or a webhook policy's rewritten replacement if one mutated it — or
    (Response, original_body) if denied. Always audits the outcome.

    Fails CLOSED. Policies are a security control: if we cannot evaluate them we
    do not know whether the call is permitted, so we deny. An enforcer that
    silently passes traffic through on an unhandled error is not an enforcer.
    """
    from app.services.policy_enforcer import check_policies
    from app.models.user import User as UserModel

    try:
        async with AsyncSessionLocal() as _db:
            _ur = await _db.execute(select(UserModel).where(UserModel.id == conn.user_id))
            _u = _ur.scalar_one_or_none()
            _role = _u.role if _u else "member"
            _allowed, _reason, _mutated = await check_policies(
                db=_db,
                server_id=server.id,
                user_id=conn.user_id,
                user_role=_role,
                tool_name=None,
                req_body=body,
            )
    except Exception as e:
        logger.error(
            f"Policy evaluation failed for server={server.slug} user={conn.user_id} "
            f"— denying request (fail-closed): {e}",
            exc_info=True,
        )
        try:
            await _log(conn, server, 403, 0, request, req_body=body, error="policy_engine_error")
        except Exception:
            logger.error("Failed to audit a fail-closed policy denial", exc_info=True)
        return _jsonrpc_denied(
            body,
            "Policy evaluation is temporarily unavailable, so this call was blocked. "
            "Contact your administrator.",
        ), body

    logger.info(f"Policy check: allowed={_allowed} reason={_reason or 'ok'}")
    if _allowed:
        return None, (_mutated if _mutated is not None else body)

    policy_name = _reason.split(":")[0].replace("Policy '", "").replace("'", "").strip()
    await _log(conn, server, 403, 0, request, req_body=body, error=policy_name)
    return _jsonrpc_denied(body, _POLICY_DENIED_MSG), body


async def _handle(token: str, request: Request, path: str = ""):
    _validate_origin(request)

    if not token:
        raise HTTPException(401, "Missing connection token")

    auth_header = request.headers.get("authorization", "")
    token_hash = hashlib.sha256(token.encode()).hexdigest()[:12] if token else None
    logger.info(f"_handle token_hash={token_hash} auth_header={'present' if auth_header else 'none'}")

    # The path/URL token only identifies *which* connection this request is
    # for (used below to build the 401 challenge) — it does not grant access
    # on its own. A raw connect URL is exactly as sensitive as a leaked
    # password if knowing it were enough to proxy through it, so actual
    # access requires a rotated access token obtained by completing
    # MCPlama's login-gated OAuth exchange. Applies to every auth_mode
    # (none/shared/per_user) — a leaked link for a shared/per_user server
    # would otherwise hand out real upstream credentials to anyone who read it.
    conn = server = None
    bearer = None
    if auth_header.startswith("Bearer "):
        bearer = auth_header.removeprefix("Bearer ").strip()
        conn, server = await _resolve_by_access_token(bearer)

    if not conn:
        if bearer:
            # Client sent a Bearer token but it's invalid/expired/revoked
            return _unauthorized(token, "invalid_token", "Token expired or revoked")
        # No access token yet — kick off the OAuth flow
        return _unauthorized(token, "unauthorized", "Authentication required")
    if not server:
        raise HTTPException(503, "Server not found or disabled")

    # ── Access control: members need approved request ─────────────────────────
    from app.models.user import User as UserModel
    from app.models.server_request import ServerRequest
    from sqlalchemy import and_
    async with AsyncSessionLocal() as _db:
        conn_user = await _db.get(UserModel, conn.user_id)
        if conn_user and conn_user.role != "admin":
            access = await _db.execute(
                select(ServerRequest).where(
                    and_(
                        ServerRequest.user_id == conn.user_id,
                        ServerRequest.server_id == server.id,
                        ServerRequest.status == "approved",
                    )
                )
            )
            if not access.scalar_one_or_none():
                raise HTTPException(403, "Access not granted. Request access from your portal.")

    # Better error for upstream 401
    # (handled downstream in proxy, but we flag it clearly)
    # ─────────────────────────────────────────────────────────────────────────

        if server.runtime == Runtime.remote:
            auth_header_name = None
            auth_header_value = None
 
            remote_auth = str(server.remote_auth).split(".")[-1]  # handle enum or string
 
            if remote_auth == "oauth":
                from app.services.mcp_client_oauth import (
                    get_upstream_token, discover_oauth_for_mcp
                )
                async with AsyncSessionLocal() as _db:
                    upstream_token = await get_upstream_token(_db, server.id, conn.user_id)
                    if not upstream_token:
                        # Also check the manual/REST-OAuth token store — a
                        # token obtained via /oauth/{id}/authorize (manual
                        # Client ID+Secret, used when the upstream server
                        # doesn't support RFC 9728/DCR, e.g. GitHub) lives
                        # there, not in the mcp_upstream store above.
                        uid = conn.user_id if str(server.auth_mode).endswith("per_user") else None
                        stored = await get_token(_db, server.id, uid)
                        if stored and stored.access_token:
                            if not stored.expires_at or stored.expires_at > datetime.utcnow():
                                upstream_token = decrypt(stored.access_token)

                if upstream_token:
                    auth_header_name = "Authorization"
                    auth_header_value = f"Bearer {upstream_token}"
                else:
                    # No token yet — check if the remote MCP server supports
                    # OAuth discovery (RFC 9728). If so, redirect through
                    # MCPlama's mcp-authorize flow. Otherwise, if manual
                    # Client ID/Secret + endpoints are configured, use the
                    # REST-style manual OAuth flow instead. Only as a last
                    # resort fall back to configured bearer/header auth.
                    mcp_url = (server.url or "").rstrip("/")
                    oauth_meta = await discover_oauth_for_mcp(mcp_url) if mcp_url else None
                    gateway_url = settings.GATEWAY_URL.rstrip("/")

                    if oauth_meta:
                        reauth_url = f"{gateway_url}/api/v1/oauth/{server.id}/mcp-authorize"
                    elif server.oauth_auth_url and server.oauth_client_id:
                        reauth_url = f"{gateway_url}/api/v1/oauth/{server.id}/authorize"
                    else:
                        reauth_url = None

                    if reauth_url:
                        # Remote MCP server uses its own OAuth — user must authorize
                        from fastapi.responses import JSONResponse
                        return JSONResponse(
                            status_code=401,
                            content={
                                "error": "upstream_auth_required",
                                "error_description": (
                                    f"Authorization required with {server.name}. "
                                    f"Please open this URL in your browser: {reauth_url}"
                                ),
                                "reauth_url": reauth_url,
                            },
                            headers={
                                "WWW-Authenticate": (
                                    f'Bearer error="upstream_auth_required", '
                                    f'reauth_url="{reauth_url}"'
                                ),
                            }
                        )
                    else:
                        # No MCP OAuth discovery and no manual config — use
                        # configured credentials
                        auth_header_name = server.auth_header_name
                        auth_header_value = decrypt(server.auth_header_value, f"server:{server.id}:auth_header_value") if server.auth_header_value else None

            elif remote_auth == "bearer":
                auth_header_name = "Authorization"
                user_token = None
                if str(server.auth_mode).endswith("per_user"):
                    async with AsyncSessionLocal() as _db:
                        stored = await get_token(_db, server.id, conn.user_id)
                    if not (stored and stored.access_token):
                        raise HTTPException(503, {
                            "code": "NOT_CONFIGURED",
                            "message": f"No personal credentials configured for {server.name}. Add them in your MCPlama portal.",
                        })
                    user_token = stored.access_token
                if user_token is not None:
                    auth_header_value = f"Bearer {user_token}"
                else:
                    _hdr_ctx = f"server:{server.id}:auth_header_value"
                    auth_header_value = f"Bearer {decrypt(server.auth_header_value, _hdr_ctx) if server.auth_header_value else ''}"

            elif remote_auth == "header":
                auth_header_name = server.auth_header_name
                user_token = None
                if str(server.auth_mode).endswith("per_user"):
                    async with AsyncSessionLocal() as _db:
                        stored = await get_token(_db, server.id, conn.user_id)
                    if not (stored and stored.access_token):
                        raise HTTPException(503, {
                            "code": "NOT_CONFIGURED",
                            "message": f"No personal credentials configured for {server.name}. Add them in your MCPlama portal.",
                        })
                    user_token = stored.access_token
                if user_token is not None:
                    auth_header_value = user_token
                else:
                    auth_header_value = decrypt(server.auth_header_value, f"server:{server.id}:auth_header_value") if server.auth_header_value else None

            # else: none — no auth header
 
            _remote_body = await request.body()
            server._proxy_user_id = conn.user_id  # pass user_id for session tracking
            return await _proxy_remote(
                server, request, path,
                auth_header_name=auth_header_name,
                auth_header_value=auth_header_value,
                body=_remote_body,
                conn=conn,
            )

    # For no-auth servers, use shared container (one per server, not per user)
    effective_auth_mode = server.auth_mode.value
    if effective_auth_mode == "none":
        effective_auth_mode = "shared"

    server_transport = getattr(server, 'transport', None) or 'http'
    # Shared servers backed by a 1:1 stdio process (docker+stdio, npx, uvx)
    # get a dedicated per-session supergateway instance instead of sharing
    # the one the container would otherwise start with — see
    # container_manager.open_session for why.
    needs_mux = cm.needs_session_multiplexing(server.runtime.value, server_transport, effective_auth_mode)

    env = await _build_env(server, conn)

    if not env and server.auth_mode.value != "none" and server.auth_type != "none":
        raise HTTPException(503, {
            "code": "NOT_CONFIGURED",
            "message": f"No credentials configured for {server.name}. Add them in the MCPlama dashboard.",
        })

    # Identity is already established above via _resolve_by_access_token for
    # every auth_mode — no separate no-auth-only gate needed here.
    # ── Policy enforcement ────────────────────────────────────────────────────
    if request.method == "POST":
        body = await request.body()
        denied, body = await _check_policies(conn, server, request, body)
        if denied is not None:
            return denied
    else:
        body = b""
    # ─────────────────────────────────────────────────────────────────────────

    if needs_mux:
        # Route by the client's own session ID if we've already handed it a
        # dedicated instance; otherwise this is a fresh session (no ID yet,
        # or one we don't recognize — e.g. after a restart) and needs one.
        incoming_session_id = request.headers.get("mcp-session-id") or dict(request.query_params).get("sessionId")
        if incoming_session_id and "," in incoming_session_id:
            # Defensive: some HTTP clients coalesce repeated header lines
            # into one comma-joined value on send. A client that received a
            # duplicated header from us before the fix above (or sits behind
            # some other header-folding layer) would otherwise never match a
            # stored session again.
            incoming_session_id = incoming_session_id.split(",")[0].strip()
        routed = bridge.route_session(incoming_session_id) if incoming_session_id else None
        if routed:
            container_name, container_port_eff = routed
            cm.touch_session(container_name, container_port_eff)
        elif incoming_session_id:
            # The client is presenting a session ID we don't recognize (idle-
            # reaped, or a backend restart forgot it) — this is NOT a fresh
            # initialize, it's a follow-up request (tools/call, etc.) that
            # assumes prior state (an open browser page) which is simply
            # gone. Silently minting a new dedicated instance and forwarding
            # that non-initialize request into it always fails — the new
            # instance was never initialized — and some MCP clients hang
            # rather than recovering from that error. Per the MCP Streamable
            # HTTP spec, an unrecognized session ID gets a 404, which tells a
            # compliant client to start a fresh session itself.
            raise HTTPException(404, {
                "error": "session_not_found",
                "error_description": "Session expired or unknown — reinitialize.",
            })
        else:
            try:
                container_name, container_port_eff = await cm.open_session(
                    server_slug=server.slug,
                    runtime=server.runtime.value,
                    docker_image=server.docker_image,
                    package=server.package,
                    args=server.args or [],
                    docker_args=getattr(server, 'docker_args', None) or [],
                    container_port=getattr(server, 'container_port', None) or 8000,
                    env=env,
                    cpu_limit=server.cpu_limit,
                    memory_limit=server.memory_limit,
                )
            except RuntimeError as e:
                raise HTTPException(503, str(e))
            except Exception as e:
                raise HTTPException(503, f"Failed to open session for {server.name}: {e}")
    else:
        container = await cm.get_container(server.slug, conn.user_id if effective_auth_mode != 'shared' else None, effective_auth_mode)

        if not container:
            try:
                container = await cm.start_container(
                    server_slug=server.slug,
                    runtime=server.runtime.value,
                    docker_image=server.docker_image,
                    package=server.package,
                    args=server.args or [],
                    docker_args=getattr(server, 'docker_args', None) or [],
                    container_port=getattr(server, 'container_port', None) or 8000,
                    env=env,
                    user_id=conn.user_id if effective_auth_mode != 'shared' else None,
                    auth_mode=effective_auth_mode,
                    transport=server_transport,
                    cpu_limit=server.cpu_limit,
                    memory_limit=server.memory_limit,
                )
            except RuntimeError as e:
                raise HTTPException(503, str(e))

            cp = getattr(server, "container_port", None) or 8000
            init_path = server.effective_mcp_path
            # skip_preinit: the actual client request is forwarded right below —
            # it's our real handshake, no need to also spend a container on
            # wait_for_container's own throwaway one.
            ready = await bridge.wait_for_container(container.name, timeout=30, port=cp, mcp_path=init_path, skip_preinit=True)
            if not ready:
                raise HTTPException(503, f"Container for {server.name} failed to start in 30s")

        container.touch()
        container_name = container.name
        container_port_eff = getattr(server, "container_port", None) or 8000

    start = time.monotonic()

    if path:
        mcp_path = f"/{path}".rstrip("/")
    else:
        mcp_path = server.effective_mcp_path

    params = dict(request.query_params)
    token_hash = hashlib.sha256(token.encode()).hexdigest()[:12] if token else None
    logger.info(
        f"CONNECT {request.method} token_hash={token_hash} "
        f"accept={request.headers.get('accept','')} "
        f"params={params} "
        f"mcp-session-id={request.headers.get('mcp-session-id','none')}"
    )

    is_npx_uvx = (
        (server.runtime and server.runtime.value in ("npx", "uvx")) or
        (server.runtime and server.runtime.value == "docker" and server_transport == "stdio")
    )

    async def _close_after(gen, name: str, port: int):
        """Wrap a stream so the dedicated session is torn down once it ends —
        used for DELETE (session termination) on a session-multiplexed server."""
        try:
            async for chunk in gen:
                yield chunk
        finally:
            await cm.close_session(name, port)

    try:
        if request.method == "GET" and is_npx_uvx:
            async def empty_sse():
                while True:
                    await asyncio.sleep(15)
                    yield b": keepalive\n\n"
            return StreamingResponse(
                empty_sse(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
            )
        elif request.method == "GET":
            return StreamingResponse(
                bridge.stream_sse(
                    container_name=container_name,
                    path=mcp_path,
                    headers=dict(request.headers),
                    params=params,
                    port=container_port_eff,
                ),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
            )
        elif is_npx_uvx:
            # supergateway streams SSE chunks asynchronously — must proxy as StreamingResponse
            await _log(conn, server, 200, int((time.monotonic() - start) * 1000), request, req_body=body)
            resp_headers = {}
            if needs_mux:
                # A StreamingResponse's headers are fixed before its body
                # generator runs, so Mcp-Session-Id — assigned by the
                # upstream response — has to be read out first here, or the
                # client can never learn it and send it back on later
                # requests (which is how it'd get routed to this same
                # dedicated instance again).
                upstream_headers, gen = await bridge.open_post_stream(
                    container_name=container_name,
                    path=mcp_path,
                    headers=dict(request.headers),
                    body=body,
                    params=params,
                    port=container_port_eff,
                )
                for h in ("mcp-session-id", "Mcp-Session-Id"):
                    val = upstream_headers.get(h) or upstream_headers.get(h.lower())
                    if val:
                        # One casing only — HTTP headers are case-insensitive
                        # on the wire, but setting both "mcp-session-id" and
                        # "Mcp-Session-Id" as separate dict entries sends two
                        # header lines with the same value. Some HTTP clients
                        # (observed with VS Code's MCP client) then coalesce
                        # those into one comma-joined value when echoing the
                        # header back, which no longer matches this session's
                        # lookup key and silently forces a brand-new session
                        # on every request.
                        resp_headers["mcp-session-id"] = val
                        break
            else:
                gen = bridge.stream_post(
                    container_name=container_name,
                    path=mcp_path,
                    headers=dict(request.headers),
                    body=body,
                    params=params,
                    port=container_port_eff,
                )
            if needs_mux and request.method == "DELETE":
                gen = _close_after(gen, container_name, container_port_eff)
            return StreamingResponse(
                gen,
                media_type="text/event-stream",
                headers={**resp_headers, "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
            )
        else:
            # body already read above for policy check
            status, resp_headers, resp_content = await bridge.forward_request(
                container_name=container_name,
                method=request.method,
                path=mcp_path,
                headers=dict(request.headers),
                body=body,
                params=params,
                port=container_port_eff,
            )
            # If container rejects session ID, clear and retry once
            if status == 400 and b"session" in resp_content.lower():
                key = bridge.session_key(container_name, container_port_eff)
                if key in bridge._sessions:
                    logger.warning(f"Stale session in connect for {key}, clearing and retrying")
                    del bridge._sessions[key]
                clean_headers = {k: v for k, v in dict(request.headers).items()
                                 if k.lower() not in ("mcp-session-id",)}
                clean_params = {k: v for k, v in params.items() if k != "sessionId"}
                status, resp_headers, resp_content = await bridge.forward_request(
                    container_name=container_name,
                    method=request.method,
                    path=mcp_path,
                    headers=clean_headers,
                    body=body,
                    params=clean_params,
                    port=container_port_eff,
                )
                logger.info(f"Retry after stale session: {status}")
            latency = int((time.monotonic() - start) * 1000)
            await _log(conn, server, status, latency, request, req_body=body)
            ct = resp_headers.get("content-type", "application/json")
            extra_headers = {}
            for h in ["mcp-session-id", "Mcp-Session-Id"]:
                val = resp_headers.get(h) or resp_headers.get(h.lower())
                if val:
                    # One casing only — see the matching comment in the
                    # is_npx_uvx branch above for why sending both breaks
                    # session routing.
                    extra_headers["mcp-session-id"] = val
                    break
            return Response(
                content=resp_content,
                status_code=status,
                media_type=ct,
                headers=extra_headers,
            )

    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except TimeoutError:
        raise HTTPException(504, f"{server.name} timed out")
    except Exception as e:
        if "ClientDisconnect" in type(e).__name__ or "disconnect" in str(e).lower():
            return Response(status_code=499)
        raise


def _resolve_extra_headers(server) -> dict:
    """
    Additional static headers configured via server.remote_headers, merged in
    on top of whatever the primary auth mechanism (OAuth/bearer/single header)
    already set — remote_auth can only ever express one auth header, this is
    for servers that need more than one.
    """
    result = {}
    for h in (server.remote_headers or []):
        key = h.get("key")
        enc_value = h.get("value")
        if not key or not enc_value:
            continue
        try:
            result[key] = decrypt(enc_value, f"server:{server.id}:remote_headers:{key}")
        except Exception:
            logger.warning(f"Failed to decrypt remote header {key!r} for server {server.id} — skipping")
    return result


async def _proxy_remote(server, request, path, auth_header_name=None, auth_header_value=None, body=None, conn=None):
    import httpx
 
    # Use whatever auth _handle resolved and passed in.
    # For OAuth servers _handle already called get_valid_oauth_token with the
    # correct per-user user_id — do NOT override with a shared lookup here.
    import time as _time
    _proxy_start = _time.monotonic()
    upstream_auth: dict = {}
 
    if auth_header_name and auth_header_value:
        # Caller resolved auth: OAuth token, bearer token, or custom header
        upstream_auth[auth_header_name] = auth_header_value
    else:
        # Fallback for shared / none servers
        async with AsyncSessionLocal() as db:
            stored = await get_token(db, server.id, None)
        if stored and stored.access_token:
            upstream_auth["Authorization"] = f"Bearer {stored.access_token}"
        elif str(server.remote_auth).endswith("bearer"):
            _hdr_ctx = f"server:{server.id}:auth_header_value"
            upstream_auth["Authorization"] = f"Bearer {decrypt(server.auth_header_value, _hdr_ctx) if server.auth_header_value else ''}"
        elif str(server.remote_auth).endswith("header") and server.auth_header_name:
            _hdr_ctx = f"server:{server.id}:auth_header_value"
            upstream_auth[server.auth_header_name] = decrypt(server.auth_header_value, _hdr_ctx) if server.auth_header_value else ""
 
    # Re-validate at request time — DNS can resolve differently than it did
    # when the server was created/updated (DNS rebinding / TOCTOU).
    await validate_remote_url(server.url)

    target = (server.url or "").rstrip("/")
    if path:
        target = f"{target}/{path.lstrip('/')}"

    skip = {"host", "content-length", "authorization", "transfer-encoding"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in skip}
    headers.update(upstream_auth)
    headers.update(_resolve_extra_headers(server))
    headers.setdefault("Accept", "application/json, text/event-stream")
    body = await request.body()
 
    # Track mcp-session-id per server+user for stateful MCP servers (Notion etc)
    session_key = f"{server.id}:{getattr(server, '_proxy_user_id', 0)}"
    existing_session = _remote_sessions.get(session_key)
    if existing_session:
        headers["mcp-session-id"] = existing_session

    # Policy enforcement — same rules as container path
    if conn and request.method == "POST" and body:
        denied, body = await _check_policies(conn, server, request, body)
        if denied is not None:
            return denied

    logger.info(f"_proxy_remote -> {request.method} {target} auth_keys={list(upstream_auth.keys())} body_len={len(body or b'')} session={existing_session or 'none'}")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            resp = await client.request(
                method=request.method,
                url=target,
                headers=headers,
                content=body or None,
                params=dict(request.query_params),
            )

        # If server returns a session ID, store it for future requests
        new_session = resp.headers.get("mcp-session-id")
        if new_session:
            _remote_sessions[session_key] = new_session
            logger.info(f"_proxy_remote: stored session {new_session[:16]}... for {session_key}")

        # If 400 with session error, clear session and retry once without it
        if resp.status_code == 400:
            resp_text = resp.content.lower()
            if b"session" in resp_text or b"invalid" in resp_text:
                logger.warning(f"_proxy_remote: 400 session error, clearing session for {session_key}")
                _remote_sessions.pop(session_key, None)
                headers.pop("mcp-session-id", None)
                async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client2:
                    resp = await client2.request(
                        method=request.method,
                        url=target,
                        headers=headers,
                        content=body or None,
                        params=dict(request.query_params),
                    )
                new_session = resp.headers.get("mcp-session-id")
                if new_session:
                    _remote_sessions[session_key] = new_session

        ct = resp.headers.get("content-type", "application/json")
        # Forward session ID back to MCP client
        extra = {}
        if new_session or existing_session:
            sid = new_session or existing_session
            extra["mcp-session-id"] = sid
            extra["Mcp-Session-Id"] = sid

        # Audit log � same as container path
        if conn:
            import time as _time
            latency = int((_time.monotonic() - _proxy_start) * 1000)
            await _log(conn, server, resp.status_code, latency, request, req_body=body)

        return Response(content=resp.content, status_code=resp.status_code,
                       media_type=ct, headers=extra)
    except httpx.ConnectError:
        raise HTTPException(503, f"Cannot connect to {server.url}")
    except httpx.TimeoutException:
        raise HTTPException(504, "Remote server timed out")

async def _log(conn, server, status_code, latency_ms, request, tool_name=None, req_body=None, error=None):
    import json as _json
    async with AsyncSessionLocal() as db:
        cr = await db.execute(select(Connection).where(Connection.token == conn.token))
        c = cr.scalar_one_or_none()
        if c:
            c.last_used_at = datetime.utcnow()

        sr = await db.execute(select(Server).where(Server.id == server.id))
        s = sr.scalar_one_or_none()
        if s:
            s.calls_today = (s.calls_today or 0) + 1
            s.calls_total = (s.calls_total or 0) + 1

        from app.models.user import User
        ur = await db.execute(select(User).where(User.id == conn.user_id))
        u = ur.scalar_one_or_none()
        user_email = u.email if u else None

        detected_tool = tool_name
        if not detected_tool and req_body:
            try:
                body = _json.loads(req_body)
                method = body.get("method", "")
                if method == "tools/call":
                    detected_tool = body.get("params", {}).get("name", "unknown")
                elif method:
                    detected_tool = method
            except Exception:
                pass

        MAX = 10_000
        req_str = None
        if req_body:
            try:
                import json as _j
                req_str = _j.dumps(_j.loads(req_body), indent=2)[:MAX]
            except Exception:
                req_str = req_body.decode("utf-8", errors="replace")[:MAX]

        meta = {"server_name": server.name, "server_slug": server.slug}
        if error:
            meta["action_taken"] = "blocked"
            meta["policy"] = error

        db.add(AuditLog(
            user_id=conn.user_id,
            user_email=user_email,
            action="proxy.call" if not error else "policy.blocked",
            server_id=server.id,
            tool=detected_tool,
            status_code=status_code,
            latency_ms=latency_ms,
            error=error,
            ip_address=request.client.host if request.client else None,
            meta=meta,
            request_body=req_str,
        ))
        await db.commit()


@router.api_route("/{token}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
@router.api_route("/{token}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy(token: str, request: Request, path: str = ""):
    return await _handle(_extract_token(token, request), request, path)


@router.api_route("", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_root(request: Request):
    return await _handle(_extract_token("", request), request, "")
