"""Repair oauth_client_mode when the credential migration was partially applied."""
from alembic import op
import sqlalchemy as sa


revision = "3c9e2a7b1d40"
down_revision = "2a7d4c9e1b30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("servers")}
    if "oauth_client_mode" not in columns:
        op.add_column(
            "servers",
            sa.Column("oauth_client_mode", sa.String(length=16), nullable=True, server_default="shared"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("servers")}
    if "oauth_client_mode" in columns:
        op.drop_column("servers", "oauth_client_mode")
