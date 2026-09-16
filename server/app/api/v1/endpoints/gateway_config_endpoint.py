# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Gateway Configuration API
Save as: backend/app/api/v1/endpoints/gateway_config_endpoint.py
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.db.session import get_db
from app.models.user import User
from app.models.gateway_config import GatewayConfig
from app.api.v1.endpoints.auth import require_admin
from app.core.config import settings

gateway_config_router = APIRouter(prefix="/gateway/config", tags=["gateway-config"])


class GatewayConfigIn(BaseModel):
    gateway_name: Optional[str] = None
    app_url: Optional[str] = None
    default_token_expiry_days: Optional[int] = None  # None = never expires
    mcp_access_token_lifetime_hours: Optional[int] = None  # None = fall back to connection expiry / 24h


class GatewayConfigOut(BaseModel):
    gateway_name: Optional[str] = None
    app_url: Optional[str] = None
    default_token_expiry_days: Optional[int] = None
    mcp_access_token_lifetime_hours: Optional[int] = None
    updated_at: Optional[datetime] = None
    class Config: from_attributes = True


async def get_effective_app_url(db: AsyncSession) -> str:
    """Get public app URL for invite links and alert emails.
    Falls back to http://localhost:5173 if not configured."""
    result = await db.execute(select(GatewayConfig).where(GatewayConfig.id == 1))
    cfg = result.scalar_one_or_none()
    if cfg and cfg.app_url:
        return cfg.app_url.rstrip('/')
    # fallback to FRONTEND_URL env or localhost:5173
    return getattr(settings, 'FRONTEND_URL', 'http://localhost:5173').rstrip('/')


async def get_effective_gateway_url(db: AsyncSession) -> str:
    """Get backend API URL for MCP connection URLs. Always from .env."""
    return settings.GATEWAY_URL.rstrip('/')


async def get_effective_gateway_name(db: AsyncSession) -> str:
    result = await db.execute(select(GatewayConfig).where(GatewayConfig.id == 1))
    cfg = result.scalar_one_or_none()
    if cfg and cfg.gateway_name:
        return cfg.gateway_name
    return getattr(settings, 'APP_NAME', 'MCPlama')


@gateway_config_router.get("", response_model=GatewayConfigOut)
async def get_config(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(GatewayConfig).where(GatewayConfig.id == 1))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return GatewayConfigOut(
            gateway_name=getattr(settings, 'APP_NAME', 'MCPlama'),
            app_url=None,
        )
    return cfg


@gateway_config_router.post("", response_model=GatewayConfigOut)
async def save_config(data: GatewayConfigIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(GatewayConfig).where(GatewayConfig.id == 1))
    cfg = result.scalar_one_or_none()
    if not cfg:
        cfg = GatewayConfig(id=1)
        db.add(cfg)
    if data.gateway_name is not None:
        cfg.gateway_name = data.gateway_name
    if data.app_url is not None:
        cfg.app_url = data.app_url.rstrip('/') if data.app_url else None
    if data.default_token_expiry_days is not None:
        cfg.default_token_expiry_days = data.default_token_expiry_days if data.default_token_expiry_days > 0 else None
    if data.mcp_access_token_lifetime_hours is not None:
        cfg.mcp_access_token_lifetime_hours = data.mcp_access_token_lifetime_hours if data.mcp_access_token_lifetime_hours > 0 else None
    cfg.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(cfg)
    return cfg