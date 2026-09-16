# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import re
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.db.session import get_db
from app.models.server import Server, ServerStatus, AuthMode
from app.models.user import User
from app.api.v1.endpoints.auth import get_current_user, require_admin
from app.services import token_store
from app.core.ssrf import validate_remote_url as _validate_remote_url
from app.core.config import settings

router = APIRouter(prefix="/servers", tags=["servers"])


def _normalize_auth_mode(value: Optional[str]) -> AuthMode:
    """Accept registry vocabulary while storing MCPlama's internal auth modes."""
    if not value:
        return AuthMode.none
    if value == "environment":
        return AuthMode.shared
    try:
        return AuthMode(value)
    except ValueError:
        raise HTTPException(422, f"Invalid auth_mode: {value}")


class ServerCreate(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = "plug"
    color: Optional[str] = "gray"
    logo_url: Optional[str] = None
    category: Optional[str] = None
    registry_id: Optional[str] = None
    docs_url: Optional[str] = None
    version: Optional[str] = None
    # runtime
    runtime: str = "remote"
    transport: Optional[str] = "http"
    docker_image: Optional[str] = None
    docker_args: Optional[List[str]] = []
    container_port: Optional[int] = 8000
    cpu_limit: Optional[str] = None
    memory_limit: Optional[str] = None
    mcp_path: Optional[str] = None
    package: Optional[str] = None
    args: Optional[List[str]] = []
    # npx/uvx only: apt package names installed before the server starts
    # (e.g. ["git"]) — see container_manager._apt_prefix.
    system_packages: Optional[List[str]] = []
    url: Optional[str] = None
    # auth
    auth_type: str = "none"
    auth_mode: str = "none"
    auth_config: Optional[dict] = {}
    user_config_schema: Optional[List[dict]] = []
    # remote auth
    remote_auth: Optional[str] = "none"
    auth_header_name: Optional[str] = None
    auth_header_value: Optional[str] = None
    # extra static headers for "remote" servers: [{"key": "...", "value": "..."}]
    remote_headers: Optional[List[dict]] = []
    # oauth
    oauth_client_id: Optional[str] = None
    oauth_client_secret: Optional[str] = None
    oauth_auth_url: Optional[str] = None
    oauth_token_url: Optional[str] = None
    oauth_scopes: Optional[str] = None
    oauth_pkce: Optional[bool] = True
    oauth_token_auth: Optional[str] = None
    # tools
    tools: Optional[List[str]] = []


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    category: Optional[str] = None
    url: Optional[str] = None
    runtime: Optional[str] = None
    docker_image: Optional[str] = None
    docker_args: Optional[List[str]] = None
    container_port: Optional[int] = None
    cpu_limit: Optional[str] = None
    memory_limit: Optional[str] = None
    mcp_path: Optional[str] = None
    package: Optional[str] = None
    args: Optional[List[str]] = None
    system_packages: Optional[List[str]] = None
    auth_type: Optional[str] = None
    auth_mode: Optional[str] = None
    auth_config: Optional[dict] = None
    remote_auth: Optional[str] = None
    auth_header_name: Optional[str] = None
    auth_header_value: Optional[str] = None
    remote_headers: Optional[List[dict]] = None
    oauth_client_id: Optional[str] = None
    oauth_client_secret: Optional[str] = None
    oauth_auth_url: Optional[str] = None
    oauth_token_url: Optional[str] = None
    oauth_scopes: Optional[str] = None
    oauth_pkce: Optional[bool] = None
    oauth_token_auth: Optional[str] = None
    user_config_schema: Optional[List[dict]] = None
    is_enabled: Optional[bool] = None
    status: Optional[str] = None
    tools: Optional[List[str]] = None


class ServerOut(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    logo_url: Optional[str] = None
    category: Optional[str] = None
    registry_id: Optional[str] = None
    docs_url: Optional[str] = None
    version: Optional[str] = None
    # runtime
    runtime: Optional[str] = "remote"
    transport: Optional[str] = "http"
    docker_image: Optional[str] = None
    docker_args: Optional[List[str]] = []
    container_port: Optional[int] = 8000
    cpu_limit: Optional[str] = None
    memory_limit: Optional[str] = None
    mcp_path: Optional[str] = None
    package: Optional[str] = None
    args: Optional[List[str]] = []
    system_packages: Optional[List[str]] = []
    url: Optional[str] = None
    # auth
    auth_type: str = "none"
    auth_mode: str = "none"
    remote_auth: Optional[str] = None
    auth_header_name: Optional[str] = None
    has_auth_header_value: bool = False
    remote_header_keys: Optional[List[str]] = []
    oauth_client_id: Optional[str] = None
    has_oauth_client_secret: bool = False
    oauth_auth_url: Optional[str] = None
    oauth_token_url: Optional[str] = None
    oauth_scopes: Optional[str] = None
    oauth_pkce: Optional[bool] = None
    oauth_token_auth: Optional[str] = None
    user_config_schema: Optional[List[dict]] = []
    # Presence-only metadata for the edit form; credential values are never
    # returned to the browser.
    configured_user_config_keys: Optional[List[str]] = []
    # tools + state
    tools: Optional[List[str]] = []
    status: str = "pending"
    is_enabled: bool = True
    calls_today: int = 0
    calls_total: int = 0
    avg_latency_ms: int = 0
    error_rate: float = 0.0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _missing_required_config(schema: List[dict], available: dict) -> List[str]:
    """
    Schema entries are required unless explicitly marked otherwise — absent
    a `required` key (true for every schema written before this field
    existed), a schema entry describes something "the user must supply" per
    its own doc comment, so treat that as the default rather than silently
    testing/enabling with an empty value and reporting fake success.
    """
    return [
        s.get("label") or s.get("key")
        for s in (schema or [])
        if s.get("required", True) and not available.get(s.get("key"))
    ]


def _encrypt_remote_headers(server_id: int, headers: Optional[List[dict]], existing: Optional[List[dict]] = None) -> List[dict]:
    """
    Encrypt a list of {"key","value"} header dicts for storage.

    A blank value for a key that already has a stored entry (in `existing`)
    keeps that key's prior encrypted value — same "blank means leave
    unchanged" convention as auth_header_value/oauth_client_secret, extended
    to a list keyed by header name. A blank value with no existing entry for
    that key is dropped: there's nothing to keep and no value to store.
    """
    from app.core.encryption import encrypt

    existing_by_key = {h.get("key"): h.get("value") for h in (existing or []) if h.get("key")}
    result = []
    for h in headers or []:
        key = (h.get("key") or "").strip()
        if not key:
            continue
        raw_value = h.get("value") or ""
        if raw_value:
            enc_value = encrypt(raw_value, f"server:{server_id}:remote_headers:{key}")
        elif key in existing_by_key:
            enc_value = existing_by_key[key]
        else:
            continue
        result.append({"key": key, "value": enc_value})
    return result


@router.get("")
async def list_servers(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0,
    search: Optional[str] = None,
):
    from sqlalchemy import func, or_
    from fastapi.responses import JSONResponse
    from fastapi.encoders import jsonable_encoder

    q = select(Server)
    if search:
        term = f"%{search}%"
        q = q.where(or_(
            Server.name.ilike(term),
            Server.category.ilike(term),
            Server.description.ilike(term),
        ))

    # Total count for pagination header
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # Paginated results
    q = q.order_by(Server.created_at.desc()).limit(limit).offset(offset)
    servers = (await db.execute(q)).scalars().all()

    data = jsonable_encoder([ServerOut.model_validate(s) for s in servers])
    return JSONResponse(
        content=data,
        headers={
            "X-Total-Count": str(total),
            "X-Limit": str(limit),
            "X-Offset": str(offset),
            "Access-Control-Expose-Headers": "X-Total-Count, X-Limit, X-Offset",
        },
    )


@router.get("/{server_id}", response_model=ServerOut)
async def get_server(server_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server not found")
    return server


@router.post("", response_model=ServerOut, status_code=201)
async def create_server(data: ServerCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    if settings.MAX_SERVERS > 0:
        from sqlalchemy import func
        server_count = (await db.execute(select(func.count(Server.id)))).scalar() or 0
        if server_count >= settings.MAX_SERVERS:
            raise HTTPException(403, f"Community edition is limited to {settings.MAX_SERVERS} servers. Upgrade to Enterprise for more.")
    if data.runtime == "remote" and data.url:
        await _validate_remote_url(data.url)
    slug = slugify(data.name)
    existing = await db.execute(select(Server).where(Server.slug == slug))
    if existing.scalar_one_or_none():
        slug = slug + "-" + str(int(datetime.utcnow().timestamp()))[-4:]
    from app.models.server import Runtime, AuthMode
    server = Server(
        name=data.name, slug=slug, description=data.description,
        icon=data.icon, color=data.color, logo_url=data.logo_url, category=data.category,
        remote_auth=data.remote_auth, auth_header_name=data.auth_header_name,
        oauth_client_id=data.oauth_client_id,
        oauth_auth_url=data.oauth_auth_url, oauth_token_url=data.oauth_token_url,
        oauth_scopes=data.oauth_scopes, oauth_pkce=data.oauth_pkce if data.oauth_pkce is not None else True,
        oauth_token_auth=data.oauth_token_auth or "basic",
        registry_id=data.registry_id, docs_url=data.docs_url, version=data.version,
        # runtime
        runtime=Runtime(data.runtime) if data.runtime else Runtime.remote,
        transport=data.transport or "http",
        docker_image=data.docker_image,
        docker_args=data.docker_args or [],
        container_port=data.container_port or 8000,
        cpu_limit=data.cpu_limit,
        memory_limit=data.memory_limit,
        mcp_path=data.mcp_path,
        package=data.package,
        args=data.args or [],
        system_packages=data.system_packages or [],
        url=data.url,
        # auth
        auth_type=data.auth_type,
        auth_mode=_normalize_auth_mode(data.auth_mode),
        user_config_schema=data.user_config_schema or [],
        # tools
        tools=data.tools or [],
        status=ServerStatus.pending, created_by=user.id,
    )
    db.add(server)
    # Flush (not commit) to get server.id assigned — the encrypted fields below
    # bind their AAD to that id, so it must exist before they're encrypted.
    await db.flush()

    from app.core.encryption import encrypt, encrypt_dict
    server.auth_config = encrypt_dict(data.auth_config or {}, context_prefix=f"server:{server.id}:auth_config")
    if data.auth_header_value:
        server.auth_header_value = encrypt(data.auth_header_value, f"server:{server.id}:auth_header_value")
    if data.oauth_client_secret:
        server.oauth_client_secret = encrypt(data.oauth_client_secret, f"server:{server.id}:oauth_client_secret")
    if data.remote_headers:
        server.remote_headers = _encrypt_remote_headers(server.id, data.remote_headers)

    await db.commit()
    await db.refresh(server)

    # Pull Docker image in background so it's ready when user connects
    if server.runtime in (Runtime.docker, Runtime.npx, Runtime.uvx):
        import asyncio
        asyncio.create_task(_pull_image_bg(server.id, server.runtime.value, server.docker_image, server.package))

    return server


async def _pull_image_bg(server_id: int, runtime: str, docker_image: str, package: str):
    """Pull Docker image in background after install. Updates server status."""
    from app.services.container_manager import pull_image, RUNNER_IMAGE
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Server).where(Server.id == server_id))
        server = result.scalar_one_or_none()
        if not server:
            return
        try:
            server.status = ServerStatus.installing
            await db.commit()
            image = docker_image if runtime == "docker" else RUNNER_IMAGE
            await pull_image(image)
            server.status = ServerStatus.pending
            await db.commit()
        except Exception as e:
            server.status = ServerStatus.error
            await db.commit()


@router.patch("/{server_id}", response_model=ServerOut)
async def update_server(server_id: int, data: ServerUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    if data.url:
        await _validate_remote_url(data.url)
    from app.core.encryption import encrypt_dict, encrypt, decrypt_dict
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server not found")
    for field, value in data.model_dump(exclude_none=True).items():
        if field in ("auth_header_value", "oauth_client_secret") and not value:
            continue  # blank means "leave unchanged", not "clear the secret"
        if field == "auth_config":
            # Credential forms intentionally send only values the admin
            # supplied during this edit. Merge them with the existing config
            # so editing one variable cannot erase the other saved values.
            existing_config = decrypt_dict(server.auth_config or {}, context_prefix=f"server:{server.id}:auth_config")
            supplied_config = {key: raw for key, raw in (value or {}).items() if raw}
            value = encrypt_dict(
                {**existing_config, **supplied_config},
                context_prefix=f"server:{server.id}:auth_config",
            )
        elif field == "auth_mode":
            value = _normalize_auth_mode(value)
        elif field in ("auth_header_value", "oauth_client_secret"):
            value = encrypt(value, f"server:{server.id}:{field}")
        elif field == "remote_headers":
            value = _encrypt_remote_headers(server.id, value, existing=server.remote_headers)
        setattr(server, field, value)

    if server.is_enabled and server.auth_mode == AuthMode.shared and server.user_config_schema:
        cfg = decrypt_dict(server.auth_config or {}, context_prefix=f"server:{server.id}:auth_config")
        missing = _missing_required_config(server.user_config_schema, cfg)
        if missing:
            raise HTTPException(400, f"Cannot enable {server.name} — missing required configuration: {', '.join(missing)}.")

    await db.commit()
    await db.refresh(server)
    return server


@router.delete("/{server_id}", status_code=204)
async def delete_server(
    server_id: int,
    delete_image: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server not found")

    # Find all connections for this server and stop their containers
    from app.models.connection import Connection
    conn_result = await db.execute(select(Connection).where(Connection.server_id == server_id))
    connections = conn_result.scalars().all()

    # The image is only a valid removal candidate while we still know it and
    # can check whether another server still depends on it — both need to
    # happen before the row is gone.
    is_docker = server.runtime and server.runtime.value == "docker"
    image = (server.docker_image or server.package) if is_docker else None
    if delete_image and image:
        from sqlalchemy import or_
        other = await db.execute(
            select(Server.id).where(
                Server.id != server_id,
                or_(Server.docker_image == image, Server.package == image),
            )
        )
        if other.scalar_one_or_none() is not None:
            delete_image = False  # still in use by another server config

    runtime = server.runtime.value if server.runtime else None
    auth_mode = server.auth_mode.value
    server_slug = server.slug
    connection_user_ids = [conn.user_id for conn in connections]

    if runtime and runtime != "remote":
        from app.services import container_manager as cm
        await cm.stop_server_containers(server_slug, connection_user_ids, auth_mode)

    if delete_image and image:
        from app.services import container_manager as cm
        await cm.sweep_image(image)
        result = await cm.remove_image(image)
        if result.get("removed"):
            import logging
            logging.getLogger(__name__).info(f"Removed image {image} after server deleted")
        else:
            import logging
            logging.getLogger(__name__).warning(f"Failed to remove image {image}: {result.get('error')}")

    # Connection.server_id isn't a DB-level FK, so these rows would otherwise
    # be orphaned — surviving as "Active" in the Connections list forever
    # even though their server no longer exists.
    for conn in connections:
        await db.delete(conn)

    await db.delete(server)
    await db.commit()



async def _run_oauth_discovery(server) -> dict:
    try:
        from app.services.mcp_client_oauth import discover_oauth_for_mcp
        mcp_url = (server.url or '').rstrip('/')
        if not mcp_url:
            return {'status': 'error', 'message': 'No URL configured'}
        meta = await discover_oauth_for_mcp(mcp_url)
        if meta:
            return {
                'status': 'ok',
                'auth_endpoint': meta.get('authorization_endpoint'),
                'token_endpoint': meta.get('token_endpoint'),
                'registration_endpoint': meta.get('registration_endpoint'),
                'dynamic_registration': bool(meta.get('registration_endpoint')),
            }
        return {
            'status': 'failed',
            'message': 'OAuth auto-discovery failed. Edit the server and add Client ID and Secret manually under Manual credentials.',
        }
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

@router.post("/{server_id}/test")
async def test_connection(server_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Start container, send initialize, discover tools, stop container. Returns tool list."""
    import asyncio, httpx, time, json as _json
    from app.services import container_manager as cm
    from app.services.stdio_bridge import wait_for_container
    from app.services.token_store import get_token
    from app.core.encryption import decrypt_dict
    from app.services.binary_detect import detect_missing_package

    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server not found")

    # Remote servers — ping and check status
    if server.runtime and server.runtime.value == "remote":
        start = time.monotonic()
        try:
            auth_headers = {"Content-Type": "application/json"}

            if server.remote_auth == "oauth":
                from app.api.v1.endpoints.oauth import get_valid_oauth_token
                from app.db.session import AsyncSessionLocal
                async with AsyncSessionLocal() as _db:
                    oauth_token = await get_valid_oauth_token(server.id, user.id, _db)
                if oauth_token:
                    auth_headers["Authorization"] = f"Bearer {oauth_token}"
                else:
                    # No token yet — run discovery so admin sees if auto-discovery works
                    oauth_discovery = await _run_oauth_discovery(server)
                    return {
                        "ok": True,
                        "status": "oauth_required",
                        "message": "Server reachable. User must authorize via the portal before connecting.",
                        "tools": [],
                        "latency_ms": int((time.monotonic() - start) * 1000),
                        "oauth_discovery": oauth_discovery,
                    }
            elif server.remote_auth in ("bearer", "header") and server.auth_mode.value == "per_user":
                stored = await get_token(db, server.id, user.id)
                if stored and stored.access_token:
                    header_name = "Authorization" if server.remote_auth == "bearer" else server.auth_header_name
                    header_value = f"Bearer {stored.access_token}" if server.remote_auth == "bearer" else stored.access_token
                    auth_headers[header_name] = header_value
                else:
                    return {
                        "ok": True,
                        "status": "credentials_required",
                        "message": "Server reachable. Each member (including you) must save their personal token via the portal before connecting.",
                        "tools": [],
                        "latency_ms": int((time.monotonic() - start) * 1000),
                    }
            elif server.auth_header_name and server.auth_header_value:
                from app.core.encryption import decrypt as _decrypt_auth_header
                auth_headers[server.auth_header_name] = _decrypt_auth_header(
                    server.auth_header_value, f"server:{server.id}:auth_header_value"
                )

            if server.remote_headers:
                import logging as _logging
                from app.core.encryption import decrypt as _decrypt_header
                _logger = _logging.getLogger(__name__)
                for h in server.remote_headers:
                    key = h.get("key")
                    enc_value = h.get("value")
                    if not key or not enc_value:
                        continue
                    try:
                        auth_headers[key] = _decrypt_header(enc_value, f"server:{server.id}:remote_headers:{key}")
                    except Exception:
                        _logger.warning(f"Failed to decrypt remote header {key!r} for server {server.id} in test-connection")

            async with httpx.AsyncClient(timeout=10) as client:
                try:
                    resp = await client.post(
                        server.url or "",
                        json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                              "params": {"protocolVersion": "2024-11-05",
                                         "capabilities": {},
                                         "clientInfo": {"name": "mcplama-test", "version": "1.0"}}},
                        headers=auth_headers,
                        follow_redirects=True,
                    )
                except Exception:
                    resp = await client.get(server.url or "", headers=auth_headers, follow_redirects=True)

            latency_ms = int((time.monotonic() - start) * 1000)

            if resp.status_code == 401:
                if server.remote_auth == "oauth":
                    raise HTTPException(400, "OAuth token rejected — your session may have expired. Go to Connect tab and re-authenticate.")
                if not server.auth_header_value:
                    raise HTTPException(400, "Authentication required — this server needs credentials. Edit the server and set the authentication type and token.")
                raise HTTPException(400, "Authentication failed (401) — your token may be expired or invalid. Update credentials in server settings.")
            if resp.status_code == 403:
                raise HTTPException(400, "Forbidden (403) — your token doesn't have permission. Check your API key scopes or re-authenticate.")
            if resp.status_code >= 400:
                raise HTTPException(400, f"Server returned {resp.status_code} — check the URL and credentials.")

            tools = []
            try:
                data = resp.json()
                tools = data.get("result", {}).get("capabilities", {}).get("tools", [])
                if isinstance(tools, dict):
                    tools = list(tools.keys())
            except Exception:
                pass

            result = {"ok": True, "latency_ms": latency_ms, "tools": tools,
                      "message": f"Connected successfully ({resp.status_code})"}
            if str(server.remote_auth).endswith("oauth"):
                result["oauth_discovery"] = await _run_oauth_discovery(server)
            return result

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"Connection failed: {str(e)}")

    # Container servers — start, initialize, list tools
    session_to_close = None
    try:
        env = {}
        schema = server.user_config_schema or []
        if server.auth_mode.value == "shared":
            cfg = decrypt_dict(server.auth_config or {}, context_prefix=f"server:{server.id}:auth_config")
            env = {k: v for k, v in cfg.items() if v}
            missing = _missing_required_config(schema, cfg)
            if missing:
                raise HTTPException(400, f"Missing required configuration: {', '.join(missing)}. Set it in server settings before testing.")
        elif server.auth_mode.value == "per_user":
            stored = await get_token(db, server.id, user.id)
            token_val = stored.access_token if stored and stored.access_token else None
            if schema:
                key = schema[0].get("key", "API_TOKEN")
                if token_val:
                    env[key] = token_val
                elif schema[0].get("required", True):
                    label = schema[0].get("label") or key
                    raise HTTPException(400, f"Missing required credential: {label}. Save your personal token via the portal before testing.")

        # none-auth servers always use a shared container (same as connect.py)
        effective_auth_mode = "shared" if server.auth_mode.value == "none" else server.auth_mode.value
        effective_user_id = None if effective_auth_mode == "shared" else user.id
        server_transport = getattr(server, 'transport', None) or 'http'
        needs_mux = cm.needs_session_multiplexing(server.runtime.value, server_transport, effective_auth_mode)

        if needs_mux:
            # Shared servers backed by a 1:1 stdio process (docker+stdio, npx,
            # uvx) idle at startup — there's no listener on container_port
            # until a real session is opened, same as connect.py's own
            # handshake. Open a throwaway session for this test and close it
            # again once done so it doesn't linger as an orphaned instance.
            container_host, port = await cm.open_session(
                server_slug=server.slug,
                runtime=server.runtime.value,
                docker_image=server.docker_image,
                package=server.package,
                args=server.args or [],
                docker_args=server.docker_args or [],
                container_port=server.container_port or 8000,
                env=env,
                cpu_limit=server.cpu_limit,
                memory_limit=server.memory_limit,
                system_packages=server.system_packages or [],
            )
            session_to_close = (container_host, port)
        else:
            # Start or get container
            container = await cm.get_container(server.slug, effective_user_id, effective_auth_mode)
            if not container:
                container = await cm.start_container(
                    server_slug=server.slug,
                    runtime=server.runtime.value,
                    docker_image=server.docker_image,
                    package=server.package,
                    args=server.args or [],
                    docker_args=server.docker_args or [],
                    container_port=server.container_port or 8000,
                    env=env,
                    user_id=effective_user_id,
                    auth_mode=effective_auth_mode,
                    transport=server_transport,
                    cpu_limit=server.cpu_limit,
                    memory_limit=server.memory_limit,
                    system_packages=server.system_packages or [],
                )
                # skip_preinit: the initialize + tools/list below is our own real
                # handshake — no need to also spend a container on wait_for_container's.
                await wait_for_container(container.name, timeout=20, port=server.container_port or 8000, skip_preinit=True)
            container_host = container.name
            port = server.container_port or 8000

        # Send initialize + tools/list
        url = f"http://{container_host}:{port}{server.effective_mcp_path}"
        start = time.monotonic()

        # Sentinel ids (not 1/2) so this never collides with the pre-init
        # handshake wait_for_container() just ran against the same
        # "stateless" supergateway bridge — a colliding id can crash the
        # whole Node process on a slow-starting npx/uvx child (see
        # stdio_bridge._pre_initialize for the full explanation).
        async def _post_mcp(client, body: bytes, headers: dict, params: dict | None = None):
            async with client.stream(
                "POST",
                url,
                content=body,
                headers=headers,
                params=params or {},
            ) as resp:
                chunks = []
                async for chunk in resp.aiter_bytes(512):
                    if not chunk:
                        continue
                    chunks.append(chunk)
                    buffered = b"".join(chunks)
                    text = buffered.decode(errors="replace")
                    if text.startswith("event:") or text.startswith("data:"):
                        if "\n\n" in text:
                            break
                    else:
                        try:
                            _json.loads(text)
                            break
                        except Exception:
                            pass
                return resp.status_code, dict(resp.headers), b"".join(chunks)

        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=10.0)) as client:
            # Initialize
            init_body = _json.dumps({"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mcplama-test","version":"1.0"}},"id":999000002}).encode()
            r_status, r_headers, _ = await _post_mcp(
                client,
                init_body,
                {"Content-Type":"application/json","Accept":"application/json, text/event-stream"},
            )
            session_id = r_headers.get("mcp-session-id") or r_headers.get("Mcp-Session-Id")

            # Complete the MCP initialization handshake before asking for
            # tools. Some servers reject any request sent before this
            # notification, even after initialize returned successfully.
            initialized_hdrs = {"Content-Type":"application/json","Accept":"application/json, text/event-stream"}
            initialized_params = {}
            if session_id:
                initialized_hdrs["mcp-session-id"] = session_id
                initialized_params["sessionId"] = session_id
            initialized_body = _json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"}).encode()
            await _post_mcp(client, initialized_body, initialized_hdrs, initialized_params)

            # List tools
            tools_hdrs = {"Content-Type":"application/json","Accept":"application/json, text/event-stream"}
            tools_params = {}
            if session_id:
                tools_hdrs["mcp-session-id"] = session_id
                tools_params["sessionId"] = session_id
            tools_body = _json.dumps({"jsonrpc":"2.0","method":"tools/list","params":{},"id":999000003}).encode()
            tr_status, _, tr_content = await _post_mcp(client, tools_body, tools_hdrs, tools_params)

        latency = int((time.monotonic() - start) * 1000)

        # A container whose wrapped npx/uvx process crashed on launch (e.g. a
        # missing system binary) still answers HTTP — supergateway itself
        # stays up — so only a non-2xx status or a JSON-RPC error payload,
        # never an exception, reveals the failure. Treating an unparsable or
        # error body as "0 tools" here previously reported every such crash
        # as a successful connection.
        async def _fail(message: str):
            # The crashed child's stderr can lag slightly behind the HTTP
            # failure it caused — supergateway relays it asynchronously and
            # the log driver flushes in its own time — so a single fetch
            # right after the failure sometimes misses it. Retry briefly
            # rather than reporting no suggestion when one actually exists.
            suggested = None
            diagnostic = None
            for attempt in range(4):
                log_text = (
                    await cm.get_stdio_logs(container_host)
                    if server.runtime.value == "docker" and server_transport == "stdio"
                    else await cm.get_session_logs(container_host, port) if needs_mux
                    else await cm.get_container_logs(container_host)
                )
                suggested = detect_missing_package(log_text)
                # Keep the API error useful when the wrapper itself is healthy
                # but the child process failed.  Only expose short, actionable
                # error lines; the full container log may contain credentials
                # or unrelated startup noise.
                diagnostic_lines = []
                for line in log_text.splitlines():
                    lower = line.lower()
                    if any(marker in lower for marker in (
                        "npm error", "error:", "invalid package", "failed to",
                        "out of memory", "oom", "killed", "no space",
                        "invalid_client", "client_assertion", "signature is invalid",
                        "eaddrinuse", "address already in use",
                    )):
                        clean = line.strip()
                        if clean and clean not in diagnostic_lines:
                            diagnostic_lines.append(clean)
                if diagnostic_lines:
                    diagnostic = " ".join(diagnostic_lines[-3:])[:600]
                if suggested:
                    break
                await asyncio.sleep(0.5)
            # A failed stdio child often surfaces as a generic HTTP 400 from
            # supergateway. Resource advice is appropriate only when the
            # captured log actually indicates a resource failure; it must not
            # obscure package, dependency, or protocol errors.
            log_lower = log_text.lower()
            resource_failure = any(marker in log_lower for marker in (
                "out of memory", "oom", "killed", "insufficient memory",
                "memory limit", "cpu limit", "range of cpus",
                "minimum memory limit",
            ))
            if resource_failure:
                message += (
                    " Edit this server and adjust its resource limits if needed "
                    "(for example CPU limit 1 and memory limit 256m), then test again."
                )
            elif diagnostic:
                message += f" Server error: {diagnostic}"
            else:
                if server.runtime.value == "docker" and server_transport == "stdio":
                    message += (
                        " The MCP process did not provide a readable error. "
                        "Check the broker log with: docker exec mcplama "
                        "sh -c 'tail -200 /var/log/mcplama/broker.log'"
                    )
                elif server.runtime.value == "docker":
                    message += (
                        " The MCP process did not provide a readable error. "
                        f"Check its logs with: docker logs {container_host}"
                    )
                else:
                    message += " The MCP process did not provide a readable error. Check the server logs for details."
            raise HTTPException(
                400,
                {
                    "message": message,
                    "suggested_package": suggested,
                },
            )

        if r_status >= 400:
            await _fail(f"initialize failed with HTTP {r_status}")
        if tr_status >= 400:
            await _fail(f"tools/list failed with HTTP {tr_status}")

        # Parse tools from response (may be SSE or JSON)
        try:
            body = tr_content.decode()
            data = None
            if body.startswith("event:") or body.startswith("data:"):
                for line in body.splitlines():
                    if line.startswith("data:"):
                        data = _json.loads(line[5:].strip())
                        break
                if data is None:
                    raise ValueError("no data: line in SSE response")
            else:
                data = _json.loads(body)
        except Exception as e:
            await _fail(f"tools/list returned an unparsable response: {e}")

        if data.get("error"):
            await _fail(f"tools/list returned an error: {data['error'].get('message', data['error'])}")

        tools = [t["name"] for t in (data.get("result") or {}).get("tools", [])]

        # Save tools to server
        server.tools = tools
        await db.commit()

        return {"ok": True, "latency_ms": latency, "tools": tools, "tool_count": len(tools)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Test failed: {str(e)}")
    finally:
        if session_to_close:
            await cm.close_session(*session_to_close)


@router.get("/{server_id}/auth-status")
async def auth_status(server_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server not found")
    if server.auth_type == "none":
        return {"status": "not_required"}
    from app.core.encryption import decrypt_dict
    cfg = decrypt_dict(server.auth_config or {}, context_prefix=f"server:{server.id}:auth_config")
    if server.auth_type == "api_token":
        has_token = bool(cfg.get("token"))
        return {"status": "connected" if has_token else "not_connected", "mode": server.auth_mode}
    if server.auth_type == "oauth2":
        uid = user.id if server.auth_mode == "per_user" else None
        status = await token_store.get_status(db, server_id, uid)
        return {"status": status, "mode": server.auth_mode}
    return {"status": "unknown"}


@router.get("/{server_id}/credentials/status")
async def credentials_status(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check if user has credentials saved for this server."""
    from app.services.token_store import get_token
    token = await get_token(db, server_id, current_user.id)
    return {"has_credentials": token is not None and bool(token.access_token)}


@router.post("/{server_id}/credentials", status_code=204)
async def save_user_credentials(
    server_id: int,
    credentials: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save per-user credentials for a server (stored as encrypted server token)."""
    from app.services.token_store import save_token
    from app.core.encryption import encrypt
    from app.services import container_manager as cm

    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Store first credential value as access_token
    schema = server.user_config_schema or []
    if not schema:
        raise HTTPException(400, "This server has no user credential schema")

    primary_key = schema[0].get("key")
    primary_value = credentials.get(primary_key)
    if not primary_value:
        raise HTTPException(400, f"Missing required credential: {primary_key}")

    await save_token(
        db=db,
        server_id=server_id,
        user_id=current_user.id,
        access_token=primary_value,
    )

    # The per-user container (if any) already has the old credential baked
    # into its env — npx/uvx/docker processes only read env at start, so a
    # running container never sees an updated token. Stop it so the next
    # request starts a fresh one with the new value instead of silently
    # keeping the stale (possibly invalid) credential indefinitely.
    await cm.stop_container(cm._container_name(server.slug, current_user.id, "per_user"))
