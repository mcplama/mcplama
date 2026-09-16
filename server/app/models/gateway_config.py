# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Gateway Configuration — stored in DB, overrides .env GATEWAY_URL at runtime.
Save as: backend/app/models/gateway_config.py
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class GatewayConfig(Base):
    __tablename__ = "gateway_config"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)  # singleton
    gateway_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    gateway_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # kept for migration compat
    app_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    default_token_expiry_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # None = never
    # Lifetime of the rotated MCP access token minted by mcp_auth.py:/token
    # after a client completes the login-gated OAuth exchange. None = fall
    # back to the connection's own expiry, or 24h if that's unset too.
    mcp_access_token_lifetime_hours: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)