# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, JSON, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    severity: Mapped[str] = mapped_column(String(16), default="warn")

    alert_type: Mapped[str] = mapped_column(String(32))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    server_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Who to notify — list of user IDs, empty = all admins
    notify_user_ids: Mapped[Optional[list]] = mapped_column(JSON, default=list)

    triggered_count: Mapped[int] = mapped_column(Integer, default=0)
    last_triggered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)