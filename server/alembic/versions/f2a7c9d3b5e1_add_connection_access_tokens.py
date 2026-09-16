# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""add connection_access_tokens table + gateway_config token lifetime setting

connection_access_tokens — the secret mcp_auth.py:/token hands back after a
client completes the login-gated OAuth exchange for a Connection. Previously
/token just echoed the raw Connection.token (the value already sitting in
the /connect/{token} URL), so anyone holding a leaked connect link could
self-supply an Authorization: Bearer header with that same value and skip
the login step entirely — the "authenticate with MCPlama" flow verified
nothing that a copy-pasted URL couldn't already satisfy. This table stores a
distinct, rotated token per exchange so /connect/{token} can require proof
of having actually completed the login step, not just knowledge of the URL.

gateway_config.mcp_access_token_lifetime_hours — admin-configurable lifetime
for that rotated token, mirroring default_token_expiry_days. None keeps the
existing fallback (connection's own expiry, or 24h if unset).

Revision ID: f2a7c9d3b5e1
Revises: e91b6a2f4d10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2a7c9d3b5e1"
down_revision: Union[str, None] = "e91b6a2f4d10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "connection_access_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("connection_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_connection_access_tokens_connection_id",
        "connection_access_tokens", ["connection_id"],
    )
    op.create_index(
        "ix_connection_access_tokens_token",
        "connection_access_tokens", ["token"], unique=True,
    )

    op.add_column(
        "gateway_config",
        sa.Column("mcp_access_token_lifetime_hours", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("gateway_config", "mcp_access_token_lifetime_hours")
    op.drop_index("ix_connection_access_tokens_token", table_name="connection_access_tokens")
    op.drop_index("ix_connection_access_tokens_connection_id", table_name="connection_access_tokens")
    op.drop_table("connection_access_tokens")
