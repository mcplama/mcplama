"""Add a separate log for server configuration and credential changes."""

from alembic import op
import sqlalchemy as sa


revision = "4d6f8a2b9c10"
down_revision = "3c9e2a7b1d40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "change_audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("user_email", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("server_id", sa.Integer(), nullable=True),
        sa.Column("server_name", sa.String(length=255), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_change_audit_logs_timestamp", "change_audit_logs", ["timestamp"])
    op.create_index("ix_change_audit_logs_user_id", "change_audit_logs", ["user_id"])
    op.create_index("ix_change_audit_logs_action", "change_audit_logs", ["action"])
    op.create_index("ix_change_audit_logs_server_id", "change_audit_logs", ["server_id"])


def downgrade() -> None:
    op.drop_index("ix_change_audit_logs_server_id", table_name="change_audit_logs")
    op.drop_index("ix_change_audit_logs_action", table_name="change_audit_logs")
    op.drop_index("ix_change_audit_logs_user_id", table_name="change_audit_logs")
    op.drop_index("ix_change_audit_logs_timestamp", table_name="change_audit_logs")
    op.drop_table("change_audit_logs")
