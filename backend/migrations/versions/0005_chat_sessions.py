"""add chat_sessions table for rename and pin support

Revision ID: 0005_chat_sessions
Revises: 0004_theme_preference
Create Date: 2026-07-20

"""
from alembic import op
import sqlalchemy as sa

revision = "0005_chat_sessions"
down_revision = "0004_theme_preference"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_sessions",
        sa.Column("session_id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("custom_title", sa.String(), nullable=True),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_chat_sessions_user_id", "chat_sessions", ["user_id"])

    # Backfill: every session that already exists (as distinct session_ids
    # in chat_logs) gets a chat_sessions row too, so existing conversations
    # can be renamed/pinned - not just ones created after this migration.
    op.execute(
        """
        INSERT INTO chat_sessions (session_id, user_id, is_pinned, created_at)
        SELECT session_id, user_id, false, MIN(created_at)
        FROM chat_logs
        GROUP BY session_id, user_id
        ON CONFLICT (session_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_chat_sessions_user_id", table_name="chat_sessions")
    op.drop_table("chat_sessions")
