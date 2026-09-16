# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from pydantic import BaseModel
from app.db.session import get_db
from app.models.user import User
from app.models.alert import Alert
from app.models.audit import AuditLog
from app.api.v1.endpoints.auth import get_current_user, require_admin

alerts_router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertCreate(BaseModel):
    name: str
    description: Optional[str] = None
    severity: str = "warn"
    alert_type: str
    config: dict = {}
    server_id: Optional[int] = None
    is_enabled: bool = True
    notify_user_ids: List[int] = []  # empty = all admins


class AlertOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    is_enabled: bool
    severity: str
    alert_type: str
    config: dict
    server_id: Optional[int] = None
    notify_user_ids: Optional[List[int]] = []
    triggered_count: int
    last_triggered_at: Optional[datetime] = None
    created_at: datetime
    status: Optional[str] = None
    current_value: Optional[str] = None
    class Config: from_attributes = True


@alerts_router.get("")
async def list_alerts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
    limit: int = Query(20, le=200),
    offset: int = Query(0),
):
    q = select(Alert)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    alerts = (await db.execute(
        q.order_by(desc(Alert.created_at)).limit(limit).offset(offset)
    )).scalars().all()
    out = []
    for alert in alerts:
        status, value = await _evaluate_alert(alert, db)
        d = AlertOut.model_validate(alert)
        d.status = status
        d.current_value = value
        out.append(d)
    data = jsonable_encoder(out)
    return JSONResponse(content=data, headers={
        "X-Total-Count": str(total),
        "X-Limit": str(limit),
        "X-Offset": str(offset),
        "Access-Control-Expose-Headers": "X-Total-Count, X-Limit, X-Offset",
    })


@alerts_router.post("", response_model=AlertOut, status_code=201)
async def create_alert(data: AlertCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    alert = Alert(**data.model_dump())
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    d = AlertOut.model_validate(alert)
    d.status = "ok"
    return d


@alerts_router.patch("/{alert_id}", response_model=AlertOut)
async def update_alert(alert_id: int, data: AlertCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(404, "Alert not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(alert, k, v)
    await db.commit()
    await db.refresh(alert)
    status, value = await _evaluate_alert(alert, db)
    d = AlertOut.model_validate(alert)
    d.status = status
    d.current_value = value
    return d


@alerts_router.patch("/{alert_id}/toggle", response_model=AlertOut)
async def toggle_alert(alert_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(404, "Alert not found")
    alert.is_enabled = not alert.is_enabled
    await db.commit()
    await db.refresh(alert)
    status, value = await _evaluate_alert(alert, db)
    d = AlertOut.model_validate(alert)
    d.status = status
    d.current_value = value
    return d


@alerts_router.delete("/{alert_id}", status_code=204)
async def delete_alert(alert_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(404, "Alert not found")
    await db.delete(alert)
    await db.commit()


@alerts_router.get("/check", summary="Check all alerts and return firing ones")
async def check_alerts(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    from app.models.server import Server
    from app.services.email_service import send_email, alert_email
    from app.core.config import settings

    result = await db.execute(select(Alert).where(Alert.is_enabled == True))
    alerts = result.scalars().all()
    firing = []

    for alert in alerts:
        status, value = await _evaluate_alert(alert, db)
        if status == "firing":
            alert.triggered_count = (alert.triggered_count or 0) + 1
            alert.last_triggered_at = datetime.utcnow()

            # Get server name
            server_name = ""
            if alert.server_id:
                sr = await db.execute(select(Server).where(Server.id == alert.server_id))
                s = sr.scalar_one_or_none()
                server_name = s.name if s else ""

            firing.append({
                "id": alert.id, "name": alert.name,
                "severity": alert.severity, "value": value,
                "server": server_name,
            })

            # Determine who to notify — only if email notifications enabled
            try:
                if not (alert.config or {}).get('notify_by_email'):
                    continue

                # Cooldown check
                from datetime import timedelta
                cooldown = (alert.config or {}).get("cooldown_seconds", 3600)
                if alert.last_triggered_at:
                    elapsed = (datetime.utcnow() - alert.last_triggered_at).total_seconds()
                    if elapsed < cooldown:
                        continue
                notify_ids = alert.notify_user_ids or []
                if notify_ids:
                    # Notify specific users
                    user_result = await db.execute(
                        select(User).where(User.id.in_(notify_ids), User.is_active == True)
                    )
                    notify_users = user_result.scalars().all()
                else:
                    # Default: notify all admins
                    admin_result = await db.execute(
                        select(User).where(User.role == "admin", User.is_active == True)
                    )
                    notify_users = admin_result.scalars().all()

                try:
                    from app.api.v1.endpoints.gateway_config_endpoint import get_effective_gateway_url
                    _gurl = await get_effective_gateway_url(db)
                except Exception:
                    _gurl = settings.GATEWAY_URL
                subject, html = alert_email(
                    alert_name=alert.name,
                    severity=alert.severity,
                    current_value=value,
                    server_name=server_name,
                    dashboard_url=_gurl,
                    logo_url=f"{_gurl.rstrip('/')}/icons/mcplama-icon-128.png",
                )
                for user in notify_users:
                    await send_email(db, user.email, subject, html)
            except Exception as e:
                import logging; logging.getLogger(__name__).warning(f"Alert email error: {e}")

    await db.commit()
    return {"firing": firing, "total": len(alerts)}


async def _evaluate_alert(alert: Alert, db: AsyncSession):
    """Evaluate an alert against current audit data. Returns (status, current_value)."""
    cfg = alert.config or {}
    now = datetime.utcnow()

    if alert.alert_type == "error_rate":
        window = cfg.get("window_seconds", 3600)
        threshold = cfg.get("threshold", 10)
        since = now - timedelta(seconds=window)
        q = select(AuditLog).where(AuditLog.timestamp >= since)
        if alert.server_id:
            q = q.where(AuditLog.server_id == alert.server_id)
        result = await db.execute(q)
        logs = result.scalars().all()
        if not logs:
            return "ok", "0%"
        errors = sum(1 for l in logs if (l.status_code or 0) >= 400)
        rate = round((errors / len(logs)) * 100)
        status = "firing" if rate >= threshold else "ok"
        return status, f"{rate}% error rate ({errors}/{len(logs)} calls)"

    elif alert.alert_type == "call_spike":
        window = cfg.get("window_seconds", 300)
        threshold = cfg.get("threshold", 100)
        since = now - timedelta(seconds=window)
        q = select(func.count(AuditLog.id)).where(AuditLog.timestamp >= since)
        if alert.server_id:
            q = q.where(AuditLog.server_id == alert.server_id)
        result = await db.execute(q)
        count = result.scalar() or 0
        status = "firing" if count >= threshold else "ok"
        return status, f"{count} calls in last {window}s"

    elif alert.alert_type == "policy_violation":
        window = cfg.get("window_seconds", 3600)
        since = now - timedelta(seconds=window)
        q = select(func.count(AuditLog.id)).where(
            AuditLog.timestamp >= since,
            AuditLog.action == "policy.blocked"
        )
        if alert.server_id:
            q = q.where(AuditLog.server_id == alert.server_id)
        result = await db.execute(q)
        count = result.scalar() or 0
        status = "firing" if count > 0 else "ok"
        return status, f"{count} violations in last {window}s"

    elif alert.alert_type == "new_user":
        window = cfg.get("window_seconds", 86400)
        since = now - timedelta(seconds=window)
        from app.models.user import User as UserModel
        result = await db.execute(
            select(func.count(UserModel.id)).where(UserModel.created_at >= since)
        )
        count = result.scalar() or 0
        threshold = cfg.get("threshold", 1)
        status = "firing" if count >= threshold else "ok"
        return status, f"{count} new users in last {window}s"

    return "ok", "—"
