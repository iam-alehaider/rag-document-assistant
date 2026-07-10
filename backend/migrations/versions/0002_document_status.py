"""add document status tracking

Revision ID: 0002_document_status
Revises: 0001_initial
Create Date: 2026-07-09

"""
from alembic import op
import sqlalchemy as sa

revision = "0002_document_status"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("status", sa.String(), nullable=False, server_default="ready"),
    )
    op.add_column("documents", sa.Column("error_message", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "error_message")
    op.drop_column("documents", "status")
