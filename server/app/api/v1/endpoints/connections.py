# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import asyncio
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from app.db.session import get_db
from app.models.connection import Connection
from app.models.server import Server
from app.models.user import User
from app.api.v1.endpoints.auth import get_current_user, require_admin
from app.core.config import settings

router = APIRouter(prefix="/connections", tags=["connections"])


class ConnectionOut(BaseModel):
    id: int
    token: str
    user_id: int
    user_email: Optional[str] = None
    server_id: int
    server_name: Optional[str] = None
    label: Optional[str] = None
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    mcp_url: str

    class Config:
        from_attributes = True


class ConnectionCreate(BaseModel):
    server_id: int
    label: Optional[str] = None
    expires_at: Optional[datetime] = None


class ConnectionPatch(BaseModel):
    is_active: Optional[bool] = None
    expires_at: Optional[datetime] = None


def _gateway_url(request: Request | None = None) -> str:
    """Return GATEWAY_URL, using the Host header when behind nginx (which sets Host $host)."""
    if request is None:
        return settings.GATEWAY_URL
    host = request.headers.get("host", "")
    if host and not host.split(":")[0] in ("localhost", "127.0.0.1"):
        parsed = urlparse(settings.GATEWAY_URL)
        return f"{parsed.scheme}://{host}"
    return settings.GATEWAY_URL


async def _enrich(conn: Connection, db: AsyncSession) -> dict:
    result = await db.execute(select(Server).where(Server.id == conn.server_id))
    server = result.scalar_one_or_none()
    user_result = await db.execute(select(User).where(User.id == conn.user_id))
    user = user_result.scalar_one_or_none()
    return {
        **{c.name: getattr(conn, c.name) for c in conn.__table__.columns},
        "server_name": server.name if server else None,
        "user_email": user.email if user else None,
        "mcp_url": f"{settings.GATEWAY_URL}/connect/{conn.token}",
    }


@router.get("")
async def list_connections(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(20, le=200),
    offset: int = Query(0),
    mine: bool = Query(False, description="Scope to the authenticated user's own connections, even for admins"),
):
    q = select(Connection)
    if user.role != "admin" or mine:
        # `user` comes from the authenticated session (get_current_user), never
        # from client input, so `mine=true` can only ever scope to the caller's
        # own connections — it cannot be used to fetch another user's tokens.
        q = q.where(Connection.user_id == user.id)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    conns = (await db.execute(
        q.order_by(Connection.created_at.desc()).limit(limit).offset(offset)
    )).scalars().all()
    data = jsonable_encoder([await _enrich(c, db) for c in conns])
    return JSONResponse(content=data, headers={
        "X-Total-Count": str(total),
        "X-Limit": str(limit),
        "X-Offset": str(offset),
        "Access-Control-Expose-Headers": "X-Total-Count, X-Limit, X-Offset",
    })


@router.post("", response_model=ConnectionOut, status_code=201)
async def create_connection(data: ConnectionCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Server).where(Server.id == data.server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server not found")

    existing = (await db.execute(
        select(Connection).where(
            Connection.user_id == user.id,
            Connection.server_id == data.server_id,
            Connection.is_active == True,
        )
    )).scalar_one_or_none()
    if existing:
        return await _enrich(existing, db)

    expires_at = data.expires_at
    if expires_at is None:
        from app.models.gateway_config import GatewayConfig
        cfg_r = await db.execute(select(GatewayConfig).where(GatewayConfig.id == 1))
        cfg = cfg_r.scalar_one_or_none()
        if cfg and cfg.default_token_expiry_days:
            from datetime import timedelta
            expires_at = datetime.utcnow() + timedelta(days=cfg.default_token_expiry_days)

    conn = Connection(user_id=user.id, server_id=data.server_id, label=data.label or f"{server.name} connection", expires_at=expires_at)
    db.add(conn)
    await db.commit()
    await db.refresh(conn)

    # Start container in background so it is ready when VS Code connects
    import logging, asyncio
    _log = logging.getLogger(__name__)
    _log.info(f"Connection created for server {server.name} runtime={server.runtime} docker_image={server.docker_image}")
    if server.runtime and server.runtime.value in ("docker", "npx", "uvx"):
        _log.info(f"Scheduling container start for {server.name}")
        asyncio.create_task(_start_container_bg(server, user.id))
    else:
        _log.warning(f"Skipping container start: runtime={server.runtime}")

    return await _enrich(conn, db)


async def _start_container_bg(server: Server, user_id: int):
    """Start container in background after connection token is generated."""
    from app.services import container_manager as cm
    from app.services.token_store import get_token
    from app.core.encryption import decrypt_dict
    from app.db.session import AsyncSessionLocal
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"_start_container_bg: server={server.name} runtime={server.runtime} auth_mode={server.auth_mode}")
        env = {}
        if server.auth_mode.value == "shared":
            env = {k: v for k, v in decrypt_dict(server.auth_config or {}, context_prefix=f"server:{server.id}:auth_config").items() if v}
            logger.info(f"Shared env keys: {list(env.keys())}")
        elif server.auth_mode.value == "per_user":
            async with AsyncSessionLocal() as db:
                stored = await get_token(db, server.id, user_id)
            if stored and stored.access_token:
                schema = server.user_config_schema or []
                key = schema[0].get("key", "API_TOKEN") if schema else "API_TOKEN"
                env[key] = stored.access_token

        if not env and server.auth_mode.value != "none" and server.auth_type != "none":
            logger.warning(f"No credentials for {server.name} — skipping container start")
            return

        # Use shared container for auth_mode=none (same logic as connect.py)
        effective_auth_mode = server.auth_mode.value
        if effective_auth_mode == "none":
            effective_auth_mode = "shared"
        effective_user_id = user_id if effective_auth_mode != "shared" else None

        existing = await cm.get_container(server.slug, effective_user_id, effective_auth_mode)
        if existing:
            logger.info(f"Container for {server.name} already running ({effective_auth_mode})")
            return

        server_transport = getattr(server, 'transport', None) or 'http'
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
        )
        logger.info(f"Container for {server.name} started: {container.name}")
        # Session-multiplexed shared servers idle at startup — sessions are
        # opened per real client (see stdio_bridge/open_session), so there's
        # no listener on container_port yet to health-check.
        if cm.needs_session_multiplexing(server.runtime.value, server_transport, effective_auth_mode):
            return
        # Pre-initialize to get session ID
        await asyncio.sleep(1)  # Give container a moment to fully start
        from app.services.stdio_bridge import wait_for_container
        cp = getattr(server, 'container_port', None) or 8000
        await wait_for_container(container.name, timeout=15, port=cp, mcp_path=server.effective_mcp_path)
    except Exception as e:
        logger.error(f"Failed to start container for {server.name}: {e}")


@router.patch("/{connection_id}")
async def update_connection(
    connection_id: int,
    data: ConnectionPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Connection).where(Connection.id == connection_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")
    changes = data.dict(exclude_unset=True)
    for field, value in changes.items():
        setattr(conn, field, value)
    await db.commit()
    await db.refresh(conn)
    if changes.get("is_active") is False:
        srv_result = await db.execute(select(Server).where(Server.id == conn.server_id))
        server = srv_result.scalar_one_or_none()
        if server and server.runtime and server.runtime.value != "remote":
            asyncio.create_task(_stop_container_bg(server, conn.user_id))
    return await _enrich(conn, db)


@router.delete("/{connection_id}", status_code=204)
async def revoke_connection(connection_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    q = select(Connection).where(Connection.id == connection_id)
    if user.role != "admin":
        q = q.where(Connection.user_id == user.id)
    result = await db.execute(q)
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    # Load server to know container details
    srv_result = await db.execute(select(Server).where(Server.id == conn.server_id))
    server = srv_result.scalar_one_or_none()

    # Delete the connection record
    await db.delete(conn)
    await db.commit()

    # Stop the container in background — don't block the response
    if server and server.runtime and server.runtime.value != "remote":
        asyncio.create_task(_stop_container_bg(server, conn.user_id))


async def _stop_container_bg(server: Server, user_id: int):
    """Stop container after connection is revoked."""
    from app.services import container_manager as cm
    import logging
    logger = logging.getLogger(__name__)
    try:
        auth_mode = cm.effective_auth_mode(server.auth_mode.value)
        container_name = cm._container_name(server.slug, user_id, auth_mode)
        await cm.stop_container(container_name)
        from app.services.stdio_bridge import clear_session
        clear_session(container_name)
        logger.info(f"Stopped container {container_name} after connection revoked")
    except Exception as e:
        logger.warning(f"Failed to stop container for {server.name}: {e}")


@router.get("/config/claude-desktop")
async def claude_desktop_config(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Connection).where(Connection.user_id == user.id, Connection.is_active == True))
    conns = result.scalars().all()
    gateway = _gateway_url(request)
    mcp_servers = {}
    for conn in conns:
        srv_result = await db.execute(select(Server).where(Server.id == conn.server_id))
        server = srv_result.scalar_one_or_none()
        if server and server.is_enabled:
            key = server.slug
            mcp_servers[key] = {
                "command": "npx",
                "args": ["mcp-remote@latest", f"{gateway}/connect/{conn.token}"]
            }
    return {"mcpServers": mcp_servers}
