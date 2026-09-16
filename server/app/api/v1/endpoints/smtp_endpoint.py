# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
SMTP Configuration API
Save as: backend/app/api/v1/endpoints/smtp_endpoint.py
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.db.session import get_db
from app.models.user import User
from app.models.smtp_config import SmtpConfig
from app.api.v1.endpoints.auth import require_admin
from app.core.encryption import encrypt

smtp_router = APIRouter(prefix="/smtp", tags=["smtp"])


class SmtpConfigIn(BaseModel):
    host: Optional[str] = None
    port: int = 587
    username: Optional[str] = None
    password: Optional[str] = None
    from_email: Optional[str] = None
    from_name: str = "MCPlama"
    use_tls: bool = True
    is_enabled: bool = True


class SmtpConfigOut(BaseModel):
    host: Optional[str] = None
    port: int = 587
    username: Optional[str] = None
    from_email: Optional[str] = None
    from_name: str = "MCPlama"
    use_tls: bool = True
    is_enabled: bool = False
    updated_at: Optional[datetime] = None
    class Config: from_attributes = True


@smtp_router.get("", response_model=SmtpConfigOut)
async def get_smtp(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(SmtpConfig).where(SmtpConfig.id == 1))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return SmtpConfigOut()
    return cfg


@smtp_router.post("", response_model=SmtpConfigOut)
async def save_smtp(data: SmtpConfigIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(SmtpConfig).where(SmtpConfig.id == 1))
    cfg = result.scalar_one_or_none()
    if not cfg:
        cfg = SmtpConfig(id=1)
        db.add(cfg)

    for k, v in data.model_dump().items():
        if k == "password":
            if not v:
                continue  # don't overwrite password with empty string
            v = encrypt(v, "smtp:password")
        setattr(cfg, k, v)
    cfg.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(cfg)
    return cfg


@smtp_router.post("/test")
async def test_smtp(to: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    """Send a test email to verify SMTP config."""
    from app.services.email_service import send_email
    html = "<p>This is a test email from MCPlama. Your SMTP configuration is working correctly! ✅</p>"
    sent = await send_email(db, to, "MCPlama — SMTP test", html, "MCPlama SMTP test — configuration working!")
    if not sent:
        raise HTTPException(400, "Failed to send email. Check your SMTP configuration.")
    return {"ok": True, "message": f"Test email sent to {to}"}
