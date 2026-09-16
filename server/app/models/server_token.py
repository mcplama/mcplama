# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class ServerToken(Base):
    __tablename__ = "server_tokens"
    __table_args__ = (UniqueConstraint("server_id", "user_id", name="uq_server_user_token"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    server_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    access_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    token_type: Mapped[Optional[str]] = mapped_column(String(32), default="Bearer")
    scope: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    is_oauth: Mapped[bool] = mapped_column(default=False)
    connected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)