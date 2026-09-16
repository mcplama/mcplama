# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class ConnectionAccessToken(Base):
    """
    Access token minted by mcp_auth.py:/token once a client completes the
    login-gated OAuth exchange for a Connection. Deliberately distinct from
    Connection.token (the value embedded in the /connect/{token} URL): that
    raw token only identifies *which* connection an /authorize request is
    for, it does not grant proxy access. Whoever holds a leaked connect URL
    still has to log into MCPlama as the connection's owner to obtain one of
    these before /connect/{token} will proxy anything for them.
    """
    __tablename__ = "connection_access_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    connection_id: Mapped[int] = mapped_column(Integer, index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
