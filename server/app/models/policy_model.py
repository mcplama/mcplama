# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, JSON, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class Policy(Base):
    __tablename__ = "policies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Scope — who this applies to
    server_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    role: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # 'admin', 'member', or None (all)

    # Policy type and config
    policy_type: Mapped[str] = mapped_column(String(32))  # rate_limit | tool_block | tool_allow | time_restrict
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    # rate_limit:    {"calls": 100, "window_seconds": 3600}
    # tool_block:    {"tools": ["delete_repository", "push_files"]}
    # tool_allow:    {"tools": ["list_repos", "list_issues"]}
    # time_restrict: {"days": [0,1,2,3,4], "start": "09:00", "end": "18:00", "timezone": "UTC"}

    action: Mapped[str] = mapped_column(String(32), default="block")  # block | warn | log

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
