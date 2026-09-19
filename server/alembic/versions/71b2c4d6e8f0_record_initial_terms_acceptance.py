# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""record initial terms acceptance

Revision ID: 71b2c4d6e8f0
Revises: f2a7c9d3b5e1
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "71b2c4d6e8f0"
down_revision: Union[str, None] = "f2a7c9d3b5e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("terms_accepted_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("terms_version", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "terms_version")
    op.drop_column("users", "terms_accepted_at")
