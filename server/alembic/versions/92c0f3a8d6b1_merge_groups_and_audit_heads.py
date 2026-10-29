# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Merge the groups and change-audit migration branches.

Revision ID: 92c0f3a8d6b1
Revises: 8a4d2c6e1f90, 5e7a9c2d4f11
"""
from typing import Sequence, Union


revision: str = "92c0f3a8d6b1"
down_revision: Union[str, tuple[str, str], None] = ("8a4d2c6e1f90", "5e7a9c2d4f11")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
