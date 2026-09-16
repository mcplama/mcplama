# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Server Access Requests API
Save as: backend/app/api/v1/endpoints/requests_endpoint.py
"""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from pydantic import BaseModel
from app.db.session import get_db
from app.models.user import User
from app.models.server import Server
from app.models.server_request import ServerRequest
from app.models.connection import Connection
from app.api.v1.endpoints.auth import get_current_user, require_admin

requests_router = APIRouter(tags=["requests"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class RequestOut(BaseModel):
    id: int
    user_id: int
    user_email: str
    user_name: str
    server_id: int
    server_name: str
    status: str
    message: Optional[str]
    created_at: datetime
    class Config: from_attributes = True


class RequestIn(BaseModel):
    message: Optional[str] = None


# ── Member: request access ────────────────────────────────────────────────────

@requests_router.post("/servers/{server_id}/request")
async def request_access(
    server_id: int,
    body: RequestIn = RequestIn(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify server exists
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    # Check not already requested/approved
    existing = await db.execute(
        select(ServerRequest).where(
            and_(
                ServerRequest.user_id == current_user.id,
                ServerRequest.server_id == server_id,
                ServerRequest.status.in_(["pending", "approved"]),
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Request already exists for this server")

    req = ServerRequest(
        user_id=current_user.id,
        server_id=server_id,
        status="pending",
        message=body.message,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return {"ok": True, "request_id": req.id, "status": "pending"}


# ── Member: get own requests ──────────────────────────────────────────────────

@requests_router.get("/requests/mine")
async def my_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ServerRequest, Server)
        .join(Server, Server.id == ServerRequest.server_id)
        .where(ServerRequest.user_id == current_user.id)
        .order_by(ServerRequest.created_at.desc())
    )
    rows = result.all()
    return [
        {
            "id": req.id,
            "server_id": req.server_id,
            "server_name": srv.name,
            "server_logo_url": srv.logo_url,
            "status": req.status,
            "message": req.message,
            "created_at": req.created_at,
        }
        for req, srv in rows
    ]


# ── Admin: list all requests ──────────────────────────────────────────────────

@requests_router.get("/requests", response_model=List[RequestOut])
async def list_requests(
    status: Optional[str] = None,   # filter: pending | approved | denied
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = select(ServerRequest, User, Server)\
        .join(User, User.id == ServerRequest.user_id)\
        .join(Server, Server.id == ServerRequest.server_id)\
        .order_by(ServerRequest.created_at.desc())\
        .limit(limit)

    if status:
        q = q.where(ServerRequest.status == status)

    result = await db.execute(q)
    rows = result.all()

    return [
        RequestOut(
            id=req.id,
            user_id=req.user_id,
            user_email=user.email,
            user_name=user.name,
            server_id=req.server_id,
            server_name=server.name,
            status=req.status,
            message=req.message,
            created_at=req.created_at,
        )
        for req, user, server in rows
    ]


# ── Admin: approve request ────────────────────────────────────────────────────

@requests_router.post("/requests/{request_id}/approve")
async def approve_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    req = await db.get(ServerRequest, request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    if req.status == "approved":
        raise HTTPException(400, "Already approved")

    # Load server
    server = await db.get(Server, req.server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    # Update status
    req.status = "approved"
    req.updated_at = datetime.utcnow()

    # Create connection token for the user
    from app.api.v1.endpoints.gateway_config_endpoint import get_effective_gateway_url
    from app.core.config import settings

    try:
        gateway_url = await get_effective_gateway_url(db)
    except Exception:
        gateway_url = settings.GATEWAY_URL

    conn = Connection(
        user_id=req.user_id,
        server_id=req.server_id,
        label=f"{server.name} connection",
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    mcp_url = f"{gateway_url}/connect/{conn.token}"

    return {
        "ok": True,
        "connection_token": conn.token,
        "mcp_url": mcp_url,
    }


# ── Admin: deny request (silent delete) ──────────────────────────────────────

@requests_router.post("/requests/{request_id}/deny")
async def deny_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    req = await db.get(ServerRequest, request_id)
    if not req:
        raise HTTPException(404, "Request not found")

    await db.delete(req)
    await db.commit()
    return {"ok": True}


# ── Admin: pre-assign user to server (skip request flow) ─────────────────────

@requests_router.post("/servers/{server_id}/assign/{user_id}")
async def assign_user(
    server_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    # Check not already assigned
    existing_conn = await db.execute(
        select(Connection).where(
            and_(
                Connection.user_id == user_id,
                Connection.server_id == server_id,
                Connection.is_active == True,
            )
        )
    )
    if existing_conn.scalar_one_or_none():
        raise HTTPException(400, "User already has access to this server")

    # Upsert approved request record
    existing_req = await db.execute(
        select(ServerRequest).where(
            and_(
                ServerRequest.user_id == user_id,
                ServerRequest.server_id == server_id,
            )
        )
    )
    req = existing_req.scalar_one_or_none()
    if req:
        req.status = "approved"
        req.updated_at = datetime.utcnow()
    else:
        req = ServerRequest(user_id=user_id, server_id=server_id, status="approved")
        db.add(req)

    # Create connection token
    from app.api.v1.endpoints.gateway_config_endpoint import get_effective_gateway_url
    from app.core.config import settings

    try:
        gateway_url = await get_effective_gateway_url(db)
    except Exception:
        gateway_url = settings.GATEWAY_URL

    conn = Connection(
        user_id=user_id,
        server_id=server_id,
        label=f"{server.name} connection",
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    mcp_url = f"{gateway_url}/connect/{conn.token}"

    return {
        "ok": True,
        "user_email": user.email,
        "server_name": server.name,
        "mcp_url": mcp_url,
    }


# ── Admin: revoke user access to server ──────────────────────────────────────

@requests_router.delete("/servers/{server_id}/members/{user_id}")
async def revoke_access(
    server_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    # Deactivate connections
    result = await db.execute(
        select(Connection).where(
            and_(
                Connection.user_id == user_id,
                Connection.server_id == server_id,
                Connection.is_active == True,
            )
        )
    )
    for conn in result.scalars().all():
        conn.is_active = False

    # Delete request record
    await db.execute(
        delete(ServerRequest).where(
            and_(
                ServerRequest.user_id == user_id,
                ServerRequest.server_id == server_id,
            )
        )
    )
    await db.commit()
    return {"ok": True}


# ── Admin/Member: list members with access to a server ───────────────────────

@requests_router.get("/servers/{server_id}/members")
async def server_members(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(
        select(ServerRequest, User)
        .join(User, User.id == ServerRequest.user_id)
        .where(
            and_(
                ServerRequest.server_id == server_id,
                ServerRequest.status == "approved",
            )
        )
        .order_by(ServerRequest.updated_at.desc())
    )
    rows = result.all()
    return [
        {
            "user_id": user.id,
            "user_name": user.name,
            "user_email": user.email,
            "approved_at": req.updated_at,
        }
        for req, user in rows
    ]