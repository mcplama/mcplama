"""Store complete per-user credential sets."""
from alembic import op
import sqlalchemy as sa


revision = "2a7d4c9e1b30"
down_revision = "71b2c4d6e8f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("server_tokens", sa.Column("credentials", sa.JSON(), nullable=True))
    op.add_column("servers", sa.Column("oauth_client_mode", sa.String(length=16), nullable=True, server_default="shared"))


def downgrade() -> None:
    op.drop_column("servers", "oauth_client_mode")
    op.drop_column("server_tokens", "credentials")
