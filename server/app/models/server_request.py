# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Server Access Request Model
Save as: backend/app/models/server_request.py
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class ServerRequest(Base):
    __tablename__ = "server_requests"

    id:         Mapped[int]           = mapped_column(primary_key=True, index=True)
    user_id:    Mapped[int]           = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    server_id:  Mapped[int]           = mapped_column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), index=True)
    status:     Mapped[str]           = mapped_column(String(20), default="pending")   # pending | approved | denied
    message:    Mapped[Optional[str]] = mapped_column(Text, nullable=True)             # optional note from user
    created_at: Mapped[datetime]      = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime]      = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
