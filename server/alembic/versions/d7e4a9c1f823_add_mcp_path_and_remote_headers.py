# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""add mcp_path and remote_headers to servers

servers.mcp_path — configurable HTTP path for a docker-runtime server's MCP
endpoint (e.g. "/api/mcp" instead of the default "/mcp"). Previously read via
getattr(server, "mcp_path", None) at several call sites, but the column never
existed, so it always fell through to the "/mcp" default — dead code.

servers.remote_headers — a list of additional static headers merged into
every proxied request to a "remote" server, on top of whatever remote_auth
already sets. remote_auth can only ever express one auth header
(auth_header_name/auth_header_value); this lets an admin attach more than one.

Revision ID: d7e4a9c1f823
Revises: c3d8f1a4b6e2
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d7e4a9c1f823"
down_revision: Union[str, None] = "c3d8f1a4b6e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("servers", sa.Column("mcp_path", sa.String(length=128), nullable=True))
    op.add_column("servers", sa.Column("remote_headers", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("servers", "remote_headers")
    op.drop_column("servers", "mcp_path")
