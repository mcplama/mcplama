# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""add password reset token columns to users

Backs the forgot/reset-password flow (sent via SMTP): a hash of the emailed
token plus its expiry. Only the hash is stored — the raw token exists only in
the emailed link — and the reset endpoint clears both columns on use, making
the token single-use.

Revision ID: a270bcd2e3ac
Revises: b1c4e7a92f10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a270bcd2e3ac"
down_revision: Union[str, None] = "b1c4e7a92f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("reset_token_hash", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("reset_token_expires", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "reset_token_expires")
    op.drop_column("users", "reset_token_hash")
