# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
SMTP Configuration — stored in DB, used for invite emails and alert notifications.
Save as: backend/app/models/smtp_config.py
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class SmtpConfig(Base):
    __tablename__ = "smtp_config"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)  # singleton row
    host: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    port: Mapped[int] = mapped_column(Integer, default=587)
    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    password: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)  # encrypted
    from_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    from_name: Mapped[str] = mapped_column(String(255), default="MCPlama")
    use_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
