# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""add user groups, memberships, and MCP server grants

Revision ID: 8a4d2c6e1f90
Revises: 71b2c4d6e8f0
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8a4d2c6e1f90"
down_revision: Union[str, None] = "71b2c4d6e8f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_user_groups_name", "user_groups", ["name"], unique=True)
    op.create_table(
        "group_memberships",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("user_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("group_id", "user_id", name="uq_group_membership"),
    )
    op.create_index("ix_group_memberships_group_id", "group_memberships", ["group_id"])
    op.create_index("ix_group_memberships_user_id", "group_memberships", ["user_id"])
    op.create_table(
        "group_server_access",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("user_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("server_id", sa.Integer(), sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("group_id", "server_id", name="uq_group_server_access"),
    )
    op.create_index("ix_group_server_access_group_id", "group_server_access", ["group_id"])
    op.create_index("ix_group_server_access_server_id", "group_server_access", ["server_id"])


def downgrade() -> None:
    op.drop_index("ix_group_server_access_server_id", table_name="group_server_access")
    op.drop_index("ix_group_server_access_group_id", table_name="group_server_access")
    op.drop_table("group_server_access")
    op.drop_index("ix_group_memberships_user_id", table_name="group_memberships")
    op.drop_index("ix_group_memberships_group_id", table_name="group_memberships")
    op.drop_table("group_memberships")
    op.drop_index("ix_user_groups_name", table_name="user_groups")
    op.drop_table("user_groups")
