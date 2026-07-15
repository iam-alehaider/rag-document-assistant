
"""add email verification, password reset, and tos acceptance

Revision ID: 0003_email_verification
Revises: 0002_document_status
Create Date: 2026-07-14

"""
from alembic import op
import sqlalchemy as sa

revision = "0003_email_verification"
down_revision = "0002_document_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("users", sa.Column("verification_token", sa.String(), nullable=True))
    op.add_column("users", sa.Column("verification_token_expires_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("reset_token", sa.String(), nullable=True))
    op.add_column("users", sa.Column("reset_token_expires_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("tos_accepted_at", sa.DateTime(), nullable=True))

    op.create_index("ix_users_verification_token", "users", ["verification_token"])
    op.create_index("ix_users_reset_token", "users", ["reset_token"])


def downgrade() -> None:
    op.drop_index("ix_users_reset_token", table_name="users")
    op.drop_index("ix_users_verification_token", table_name="users")
    op.drop_column("users", "tos_accepted_at")
    op.drop_column("users", "reset_token_expires_at")
    op.drop_column("users", "reset_token")
    op.drop_column("users", "verification_token_expires_at")
    op.drop_column("users", "verification_token")
    op.drop_column("users", "is_verified")
