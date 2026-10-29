# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import require_admin
from app.db.session import get_db
from app.models.connection import Connection
from app.models.gateway_config import GatewayConfig
from app.models.server import Server
from app.models.server_request import ServerRequest
from app.models.user import User
from app.models.user_group import GroupMembership, GroupServerAccess, UserGroup
from app.services.access_control import has_server_access
from app.services.change_audit import record_change

groups_router = APIRouter(prefix="/groups", tags=["groups"])


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None


class GroupPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None


async def _group_out(db: AsyncSession, group: UserGroup) -> dict:
    member_rows = await db.execute(
        select(User.id, User.name, User.email, User.role, User.is_active)
        .join(GroupMembership, GroupMembership.user_id == User.id)
        .where(GroupMembership.group_id == group.id)
        .order_by(User.email)
    )
    server_rows = await db.execute(
        select(Server.id, Server.name, Server.is_enabled)
        .join(GroupServerAccess, GroupServerAccess.server_id == Server.id)
        .where(GroupServerAccess.group_id == group.id)
        .order_by(Server.name)
    )
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "created_at": group.created_at,
        "updated_at": group.updated_at,
        "members": [dict(id=r.id, name=r.name, email=r.email, role=r.role.value if hasattr(r.role, "value") else r.role, is_active=r.is_active) for r in member_rows],
        "servers": [dict(id=r.id, name=r.name, is_enabled=r.is_enabled) for r in server_rows],
    }


async def _ensure_connection(db: AsyncSession, user_id: int, server: Server) -> None:
    now = datetime.utcnow()
    rows = await db.execute(select(Connection).where(Connection.user_id == user_id, Connection.server_id == server.id, Connection.is_active == True))
    for conn in rows.scalars():
        if conn.expires_at is None or conn.expires_at > now:
            return
        conn.is_active = False

    cfg = await db.get(GatewayConfig, 1)
    expiry_days = cfg.default_token_expiry_days if cfg else None
    conn = Connection(
        user_id=user_id,
        server_id=server.id,
        label=f"{server.name} connection",
        expires_at=now + timedelta(days=expiry_days) if expiry_days else None,
    )
    db.add(conn)


async def _cleanup_connections(db: AsyncSession, pairs: set[tuple[int, int]]) -> None:
    for user_id, server_id in pairs:
        if await has_server_access(db, user_id, server_id):
            continue
        rows = await db.execute(select(Connection).where(Connection.user_id == user_id, Connection.server_id == server_id, Connection.is_active == True))
        for conn in rows.scalars():
            conn.is_active = False


@groups_router.get("")
async def list_groups(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    groups = (await db.execute(select(UserGroup).order_by(UserGroup.name))).scalars().all()
    return [await _group_out(db, group) for group in groups]


@groups_router.post("", status_code=201)
async def create_group(data: GroupCreate, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    group = UserGroup(name=data.name.strip(), description=data.description)
    if not group.name:
        raise HTTPException(422, "Group name is required")
    db.add(group)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A group with this name already exists")
    record_change(db, actor, "group.created", "user_group", resource_id=group.id, resource_name=group.name,
                  fields=["name", "description"], changes=[{"field": "group", "after": group.name}])
    await db.commit()
    await db.refresh(group)
    return await _group_out(db, group)


@groups_router.patch("/{group_id}")
async def update_group(group_id: int, data: GroupPatch, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    group = await db.get(UserGroup, group_id)
    if not group:
        raise HTTPException(404, "Group not found")
    changes = []
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "name":
            value = value.strip()
            if not value:
                raise HTTPException(422, "Group name is required")
        before = getattr(group, field)
        if before != value:
            setattr(group, field, value)
            changes.append({"field": field, "before": before, "after": value})
    if changes:
        record_change(db, actor, "group.updated", "user_group", resource_id=group.id, resource_name=group.name,
                      fields=[c["field"] for c in changes], changes=changes)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A group with this name already exists")
    await db.refresh(group)
    return await _group_out(db, group)


@groups_router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    group = await db.get(UserGroup, group_id)
    if not group:
        raise HTTPException(404, "Group not found")
    members = (await db.execute(select(GroupMembership.user_id).where(GroupMembership.group_id == group_id))).scalars().all()
    server_ids = (await db.execute(select(GroupServerAccess.server_id).where(GroupServerAccess.group_id == group_id))).scalars().all()
    pairs = {(uid, sid) for uid in members for sid in server_ids}
    name = group.name
    await db.execute(delete(GroupMembership).where(GroupMembership.group_id == group_id))
    await db.execute(delete(GroupServerAccess).where(GroupServerAccess.group_id == group_id))
    await db.delete(group)
    await _cleanup_connections(db, pairs)
    record_change(db, actor, "group.deleted", "user_group", resource_id=group_id, resource_name=name,
                  fields=["deleted"], changes=[{"field": "group", "before": name, "after": "Deleted"}])
    await db.commit()


@groups_router.post("/{group_id}/members/{user_id}")
async def add_group_member(group_id: int, user_id: int, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    group = await db.get(UserGroup, group_id)
    user = await db.get(User, user_id)
    if not group or not user:
        raise HTTPException(404, "Group or user not found")
    existing = await db.execute(select(GroupMembership.id).where(GroupMembership.group_id == group_id, GroupMembership.user_id == user_id))
    if existing.scalar_one_or_none() is None:
        db.add(GroupMembership(group_id=group_id, user_id=user_id))
        server_ids = (await db.execute(select(GroupServerAccess.server_id).where(GroupServerAccess.group_id == group_id))).scalars().all()
        for sid in server_ids:
            server = await db.get(Server, sid)
            if server:
                await _ensure_connection(db, user_id, server)
        record_change(db, actor, "group.member_added", "user_group", resource_id=group.id, resource_name=group.name,
                      fields=["members"], changes=[{"field": "member", "after": user.email}], details={"target_user_id": user.id})
        await db.commit()
    return await _group_out(db, group)


@groups_router.delete("/{group_id}/members/{user_id}")
async def remove_group_member(group_id: int, user_id: int, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    group = await db.get(UserGroup, group_id)
    if not group:
        raise HTTPException(404, "Group not found")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    await db.execute(delete(GroupMembership).where(GroupMembership.group_id == group_id, GroupMembership.user_id == user_id))
    server_ids = (await db.execute(select(GroupServerAccess.server_id).where(GroupServerAccess.group_id == group_id))).scalars().all()
    await _cleanup_connections(db, {(user_id, sid) for sid in server_ids})
    record_change(db, actor, "group.member_removed", "user_group", resource_id=group.id, resource_name=group.name,
                  fields=["members"], changes=[{"field": "member", "before": user.email, "after": "Removed"}], details={"target_user_id": user.id})
    await db.commit()
    return await _group_out(db, group)


@groups_router.post("/{group_id}/servers/{server_id}")
async def grant_group_server(group_id: int, server_id: int, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    group = await db.get(UserGroup, group_id)
    server = await db.get(Server, server_id)
    if not group or not server:
        raise HTTPException(404, "Group or server not found")
    existing = await db.execute(select(GroupServerAccess.id).where(GroupServerAccess.group_id == group_id, GroupServerAccess.server_id == server_id))
    if existing.scalar_one_or_none() is None:
        db.add(GroupServerAccess(group_id=group_id, server_id=server_id))
        user_ids = (await db.execute(select(GroupMembership.user_id).where(GroupMembership.group_id == group_id))).scalars().all()
        for user_id in user_ids:
            await _ensure_connection(db, user_id, server)
        record_change(db, actor, "group.server_granted", "group_server_access", resource_id=f"{group.id}:{server.id}",
                      resource_name=f"{group.name} → {server.name}", server_id=server.id,
                      fields=["server_access"], changes=[{"field": "group_server_access", "after": "Granted"}],
                      details={"group_id": group.id, "member_count": len(user_ids)})
        await db.commit()
    return await _group_out(db, group)


@groups_router.delete("/{group_id}/servers/{server_id}")
async def revoke_group_server(group_id: int, server_id: int, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    group = await db.get(UserGroup, group_id)
    if not group:
        raise HTTPException(404, "Group not found")
    server = await db.get(Server, server_id)
    user_ids = (await db.execute(select(GroupMembership.user_id).where(GroupMembership.group_id == group_id))).scalars().all()
    await db.execute(delete(GroupServerAccess).where(GroupServerAccess.group_id == group_id, GroupServerAccess.server_id == server_id))
    await _cleanup_connections(db, {(uid, server_id) for uid in user_ids})
    record_change(db, actor, "group.server_revoked", "group_server_access", resource_id=f"{group_id}:{server_id}",
                  resource_name=f"{group.name} → {server.name if server else server_id}", server_id=server_id,
                  fields=["server_access"], changes=[{"field": "group_server_access", "before": "Granted", "after": "Revoked"}],
                  details={"group_id": group.id, "member_count": len(user_ids)})
    await db.commit()
    return await _group_out(db, group)
