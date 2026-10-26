"""Add generic resource identifiers to the administrative change log."""

from alembic import op
import sqlalchemy as sa


revision = "5e7a9c2d4f11"
down_revision = "4d6f8a2b9c10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("change_audit_logs", sa.Column("resource_type", sa.String(length=64), nullable=True))
    op.add_column("change_audit_logs", sa.Column("resource_id", sa.String(length=255), nullable=True))
    op.add_column("change_audit_logs", sa.Column("resource_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("change_audit_logs", "resource_name")
    op.drop_column("change_audit_logs", "resource_id")
    op.drop_column("change_audit_logs", "resource_type")
