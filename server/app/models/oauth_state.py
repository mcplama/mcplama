# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
OAuth State Model — temporary state during OAuth flow
Save as: backend/app/models/oauth_state.py
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text,Boolean  
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class OAuthState(Base):
    __tablename__ = "oauth_states"

    id:            Mapped[int]           = mapped_column(primary_key=True)
    server_id:     Mapped[int]           = mapped_column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), index=True)
    user_id:       Mapped[int]           = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    state:         Mapped[str]           = mapped_column(String(128), unique=True, index=True)  # random CSRF token
    code_verifier: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)            # PKCE verifier
    redirect_uri:  Mapped[str]           = mapped_column(String(500))
    created_at:    Mapped[datetime]      = mapped_column(DateTime, default=datetime.utcnow)
    resume_pending: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # Auto-expire after 10 min — cleaned by background task
