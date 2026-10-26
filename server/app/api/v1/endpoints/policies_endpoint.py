# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Policy API endpoints — replace the policies section in misc.py
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from pydantic import BaseModel
from app.db.session import get_db
from app.models.user import User
from app.models.policy import Policy
from app.api.v1.endpoints.auth import get_current_user, require_admin
from app.core.ssrf import validate_remote_url
from app.core.config import settings
from app.services.change_audit import record_change

policies_router = APIRouter(prefix="/policies", tags=["policies"])


async def _validate_policy_config(policy_type: str, config: dict) -> None:
    """
    webhook policies POST to an admin-supplied URL on every proxied tool call —
    same risk class as a "remote" server's URL, so it gets the same SSRF guard
    at save time. (It's re-validated again at call time in policy_enforcer.py
    for TOCTOU/DNS-rebinding — this check is the fail-fast one.)
    """
    if policy_type == "webhook":
        await validate_remote_url(
            config.get("url"),
            allowed_private_hosts=settings.allowed_private_webhook_hosts,
            private_url_hint=True,
        )


class PolicyCreate(BaseModel):
    name: str
    description: Optional[str] = None
    server_id: Optional[int] = None
    user_id: Optional[int] = None
    user_ids: List[int] = []
    role: Optional[str] = None
    policy_type: str
    config: dict = {}
    action: str = "block"
    is_enabled: bool = True


class PolicyOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    server_id: Optional[int] = None
    user_id: Optional[int] = None
    role: Optional[str] = None
    policy_type: str
    config: dict
    action: str
    is_enabled: bool
    created_at: datetime
    class Config: from_attributes = True


@policies_router.get("")
async def list_policies(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
    limit: int = Query(20, le=200),
    offset: int = Query(0),
):
    q = select(Policy)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    policies = (await db.execute(
        q.order_by(desc(Policy.created_at)).limit(limit).offset(offset)
    )).scalars().all()
    data = jsonable_encoder([PolicyOut.model_validate(p) for p in policies])
    return JSONResponse(content=data, headers={
        "X-Total-Count": str(total),
        "X-Limit": str(limit),
        "X-Offset": str(offset),
        "Access-Control-Expose-Headers": "X-Total-Count, X-Limit, X-Offset",
    })


@policies_router.post("", response_model=PolicyOut, status_code=201)
async def create_policy(data: PolicyCreate, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    await _validate_policy_config(data.policy_type, data.config)

    # Valid Policy model fields only
    valid_fields = {"name", "description", "is_enabled", "server_id", "user_id", "role", "policy_type", "config", "action"}
    base = {k: v for k, v in data.model_dump().items() if k in valid_fields}

    # If multiple users selected, create one policy per user
    user_ids = data.user_ids if data.user_ids else ([data.user_id] if data.user_id else [None])
    last_policy = None
    created_policies = []
    for uid in user_ids:
        d = {**base, "user_id": uid}
        policy = Policy(**d)
        db.add(policy)
        created_policies.append(policy)
        last_policy = policy
    await db.flush()
    for policy in created_policies:
        record_change(
            db, actor, "policy.created", "policy",
            resource_id=policy.id, resource_name=policy.name,
            server_id=policy.server_id,
            fields=["name", "description", "server_id", "user_id", "role", "policy_type", "config", "action", "is_enabled"],
            changes=[
                {"field": "policy", "after": "Created"},
                {"field": "policy_type", "after": policy.policy_type},
                {"field": "action", "after": policy.action},
                {"field": "is_enabled", "after": policy.is_enabled},
                {"field": "config_keys", "after": sorted((policy.config or {}).keys())},
            ],
            details={
                "policy_type": policy.policy_type,
                "action": policy.action,
                "enabled": policy.is_enabled,
                "config_keys": sorted((policy.config or {}).keys()),
                "target_user_id": policy.user_id,
                "target_role": policy.role,
            },
        )
    await db.commit()
    if last_policy:
        await db.refresh(last_policy)
    return last_policy


@policies_router.patch("/{policy_id}", response_model=PolicyOut)
async def update_policy(policy_id: int, data: PolicyCreate, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    result = await db.execute(select(Policy).where(Policy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(404, "Policy not found")
    valid_fields = {"name", "description", "is_enabled", "server_id", "user_id", "role", "policy_type", "config", "action"}
    updates = data.model_dump(exclude_unset=True)
    changed_fields = [k for k, v in updates.items() if k in valid_fields and getattr(policy, k) != v]
    old_config = policy.config or {}
    before_values = {k: getattr(policy, k) for k in changed_fields if k in {"name", "server_id", "user_id", "role", "policy_type", "action", "is_enabled"}}
    for k, v in updates.items():
        if k in valid_fields:
            setattr(policy, k, v)
    await _validate_policy_config(policy.policy_type, policy.config or {})
    if changed_fields:
        changes = [
            {"field": field, "before": before_values[field], "after": getattr(policy, field)}
            for field in before_values
        ]
        if "config" in changed_fields:
            changes.append({
                "field": "config_keys",
                "before": sorted(old_config.keys()),
                "after": sorted((policy.config or {}).keys()),
            })
        record_change(
            db, actor, "policy.updated", "policy",
            resource_id=policy.id, resource_name=policy.name,
            server_id=policy.server_id, fields=changed_fields,
            changes=changes,
            details={
                "policy_type": policy.policy_type,
                "action": policy.action,
                "enabled": policy.is_enabled,
                "config_keys": sorted(set(old_config) | set((policy.config or {}).keys())) if "config" in changed_fields else [],
                "target_user_id": policy.user_id,
                "target_role": policy.role,
            },
        )
    await db.commit()
    await db.refresh(policy)
    return policy


@policies_router.delete("/{policy_id}", status_code=204)
async def delete_policy(policy_id: int, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    result = await db.execute(select(Policy).where(Policy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(404, "Policy not found")
    record_change(
        db, actor, "policy.deleted", "policy",
        resource_id=policy.id, resource_name=policy.name,
        server_id=policy.server_id, fields=["deleted"],
        changes=[{"field": "policy", "before": policy.name, "after": "Deleted"}],
        details={"policy_type": policy.policy_type, "target_user_id": policy.user_id, "target_role": policy.role},
    )
    await db.delete(policy)
    await db.commit()


@policies_router.patch("/{policy_id}/toggle", response_model=PolicyOut)
async def toggle_policy(policy_id: int, db: AsyncSession = Depends(get_db), actor: User = Depends(require_admin)):
    result = await db.execute(select(Policy).where(Policy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(404, "Policy not found")
    was_enabled = policy.is_enabled
    policy.is_enabled = not policy.is_enabled
    record_change(
        db, actor, "policy.updated", "policy",
        resource_id=policy.id, resource_name=policy.name,
        server_id=policy.server_id, fields=["is_enabled"],
        changes=[{"field": "is_enabled", "before": was_enabled, "after": policy.is_enabled}],
        details={"enabled": policy.is_enabled},
    )
    await db.commit()
    await db.refresh(policy)
    return policy
