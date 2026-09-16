# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, or_
from pydantic import BaseModel
from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.audit import AuditLog
from app.models.server import Server
from app.api.v1.endpoints.auth import get_current_user, require_admin

users_router = APIRouter(prefix="/users", tags=["users"])
audit_router = APIRouter(prefix="/audit", tags=["audit"])
gateway_router = APIRouter(prefix="/gateway", tags=["gateway"])

# Policies router — imported from dedicated module
from app.models.policy import Policy
from app.api.v1.endpoints.policies_endpoint import policies_router

# Alerts router — imported from dedicated module
from app.models.alert import Alert
from app.api.v1.endpoints.alert_endpoint import alerts_router


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime]
    class Config: from_attributes = True


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class AuditOut(BaseModel):
    id: int
    timestamp: datetime
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    server_id: Optional[int] = None
    server_name: Optional[str] = None
    tool: Optional[str] = None
    status_code: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None
    ip_address: Optional[str] = None
    meta: Optional[dict] = None
    request_body: Optional[str] = None
    class Config: from_attributes = True


@users_router.get("")
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
    limit: int = Query(20, le=200),
    offset: int = Query(0),
    search: Optional[str] = Query(None),
):
    q = select(User)
    if search:
        term = f"%{search}%"
        q = q.where(or_(User.email.ilike(term), User.name.ilike(term)))
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    users = (await db.execute(q.order_by(User.created_at).limit(limit).offset(offset))).scalars().all()
    data = jsonable_encoder([UserOut.model_validate(u) for u in users])
    return JSONResponse(content=data, headers={
        "X-Total-Count": str(total),
        "X-Limit": str(limit),
        "X-Offset": str(offset),
        "Access-Control-Expose-Headers": "X-Total-Count, X-Limit, X-Offset",
    })


@users_router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: int, data: UserUpdate, db: AsyncSession = Depends(get_db), me: User = Depends(require_admin)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user: raise HTTPException(404, "User not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    await db.commit()
    await db.refresh(user)
    return user


@users_router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db), me: User = Depends(require_admin)):
    if user_id == me.id: raise HTTPException(400, "Cannot delete yourself")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user: raise HTTPException(404, "User not found")
    await db.delete(user)
    await db.commit()


@audit_router.get("")
async def list_audit(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    limit: int = Query(20, le=2000),
    offset: int = Query(0),
    search: Optional[str] = Query(None),
    server_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
):
    q = select(AuditLog)
    if current_user.role != "admin":
        q = q.where(AuditLog.user_id == current_user.id)
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00")).replace(tzinfo=None)
            q = q.where(AuditLog.timestamp >= since_dt)
        except ValueError:
            pass
    if server_id:
        q = q.where(AuditLog.server_id == server_id)
    if status == "ok":
        q = q.where(AuditLog.status_code < 400)
    elif status == "error":
        q = q.where(AuditLog.status_code >= 400)
    if search:
        term = f"%{search}%"
        server_name_match = select(Server.id).where(Server.name.ilike(term))
        q = q.where(or_(
            AuditLog.action.ilike(term),
            AuditLog.tool.ilike(term),
            AuditLog.user_email.ilike(term),
            AuditLog.server_id.in_(server_name_match),
        ))
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    logs = (await db.execute(
        q.order_by(desc(AuditLog.timestamp)).limit(limit).offset(offset)
    )).scalars().all()
    out = []
    for log in logs:
        d = AuditOut.model_validate(log)
        if log.meta and log.meta.get("server_name"):
            d.server_name = log.meta["server_name"]
        elif log.server_id and not d.server_name:
            sr = await db.execute(select(Server).where(Server.id == log.server_id))
            s = sr.scalar_one_or_none()
            if s:
                d.server_name = s.name
        out.append(d)
    data = jsonable_encoder(out)
    return JSONResponse(content=data, headers={
        "X-Total-Count": str(total),
        "X-Limit": str(limit),
        "X-Offset": str(offset),
        "Access-Control-Expose-Headers": "X-Total-Count, X-Limit, X-Offset",
    })


@gateway_router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    from app.core.config import settings
    from app.models.connection import Connection
    from datetime import timedelta
    servers = (await db.execute(select(Server))).scalars().all()
    active = [s for s in servers if s.is_enabled]
    cutoff = datetime.utcnow() - timedelta(minutes=30)
    active_conns = (await db.execute(
        select(Connection).where(Connection.is_active == True, Connection.last_used_at >= cutoff)
    )).scalars().all()
    total_conns = (await db.execute(select(Connection).where(Connection.is_active == True))).scalars().all()
    return {
        "total_servers": len(servers),
        "active_servers": len(active),
        "total_tools": sum(len(s.tools or []) for s in active),
        "calls_today": sum(s.calls_today for s in servers),
        "calls_total": sum(s.calls_total for s in servers),
        "active_connections": len(active_conns),
        "total_connections": len(total_conns),
        "version": settings.VERSION,
        "gateway_url": settings.GATEWAY_URL,
    }


@gateway_router.get("/config/claude-desktop")
async def claude_desktop_config(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.connection import Connection
    from app.core.config import settings
    result = await db.execute(
        select(Connection, Server)
        .join(Server, Connection.server_id == Server.id)
        .where(Connection.user_id == user.id, Connection.is_active == True)
    )
    rows = result.all()
    mcp_servers = {}
    for conn, server in rows:
        mcp_servers[server.slug] = {
            "url": f"{settings.GATEWAY_URL}/connect/{conn.token}"
        }
    return {"mcpServers": mcp_servers}