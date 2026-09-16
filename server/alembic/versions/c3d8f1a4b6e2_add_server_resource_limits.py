# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""add per-server cpu/memory resource limits

servers.cpu_limit / memory_limit — admin-configurable overrides for a
server's docker/npx/uvx container, clamped broker-side against
BROKER_MAX_CPU_LIMIT/BROKER_MEM_LIMIT so a server can be tuned without ever
exceeding the operator's ceiling. Previously every container got the same
fixed --memory 1g with no --cpus limit at all, regardless of the server.

Revision ID: c3d8f1a4b6e2
Revises: a270bcd2e3ac
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3d8f1a4b6e2"
down_revision: Union[str, None] = "a270bcd2e3ac"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("servers", sa.Column("cpu_limit", sa.String(length=16), nullable=True))
    op.add_column("servers", sa.Column("memory_limit", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("servers", "memory_limit")
    op.drop_column("servers", "cpu_limit")
