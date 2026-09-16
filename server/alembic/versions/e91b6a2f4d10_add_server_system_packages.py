# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""add system_packages to servers

servers.system_packages — apt package names (e.g. ["git"]) an npx/uvx
server needs on top of the base sandbox image. Installed via apt-get at
container start, so an admin can unblock a server whose underlying package
shells out to a missing system binary without building a custom Docker
image or touching Dockerfile.runner.

Revision ID: e91b6a2f4d10
Revises: d7e4a9c1f823
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e91b6a2f4d10"
down_revision: Union[str, None] = "d7e4a9c1f823"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("servers", sa.Column("system_packages", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("servers", "system_packages")
