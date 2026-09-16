# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""persist upstream MCP client registration + index audit_logs for rate limiting

Two changes, both replacing in-process state that did not survive a restart:

1. servers.mcp_client_id / mcp_client_secret — the dynamic client registration
   (RFC 7591) issued to us by an upstream MCP server's auth server. A user's
   refresh token is bound to the client_id it was issued against, so keeping it
   only in memory meant every restart invalidated every stored refresh token and
   silently forced all users to re-authorize.

2. ix_audit_logs_rate_limit — rate-limit policies now COUNT proxy.call rows in
   audit_logs instead of using a per-process counter. This composite index keeps
   that count off a sequential scan; the existing single-column indexes are not
   selective enough for it.

Revision ID: b1c4e7a92f10
Revises: 807329bf2a0f
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c4e7a92f10"
down_revision: Union[str, None] = "807329bf2a0f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("servers", sa.Column("mcp_client_id", sa.String(length=500), nullable=True))
    op.add_column("servers", sa.Column("mcp_client_secret", sa.Text(), nullable=True))

    op.create_index(
        "ix_audit_logs_rate_limit",
        "audit_logs",
        ["user_id", "server_id", "action", "timestamp"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_rate_limit", table_name="audit_logs")
    op.drop_column("servers", "mcp_client_secret")
    op.drop_column("servers", "mcp_client_id")
