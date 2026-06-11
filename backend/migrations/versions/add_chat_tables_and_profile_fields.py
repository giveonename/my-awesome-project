"""add chat tables and user profile fields

Revision ID: b1c2d3e4f5a6
Revises: a7b8c9d0e1f2
Create Date: 2026-05-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b1c2d3e4f5a6"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add body profile fields to user_preferences
    op.add_column("user_preferences", sa.Column("height_cm", sa.Integer(), nullable=True))
    op.add_column("user_preferences", sa.Column("weight_kg", sa.Integer(), nullable=True))
    op.add_column("user_preferences", sa.Column("body_type", sa.String(20), nullable=True))
    op.add_column("user_preferences", sa.Column("gender", sa.String(20), nullable=True))
    op.add_column("user_preferences", sa.Column("age_range", sa.String(10), nullable=True))
    op.add_column(
        "user_preferences",
        sa.Column("style_identity", postgresql.ARRAY(sa.String()), nullable=True, server_default="{}"),
    )
    op.add_column(
        "user_preferences",
        sa.Column("body_concerns", postgresql.ARRAY(sa.String()), nullable=True, server_default="{}"),
    )
    op.add_column("user_preferences", sa.Column("profession_scene", sa.String(30), nullable=True))

    # Create chat_sessions table
    op.create_table(
        "chat_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("title", sa.String(100), nullable=True),
        sa.Column("context", postgresql.JSONB(), server_default="{}"),
        sa.Column("status", sa.String(20), server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_chat_sessions_user", "chat_sessions", ["user_id", sa.text("updated_at DESC")])

    # Create chat_messages table
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_chat_messages_session", "chat_messages", ["session_id", "created_at"])


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("chat_sessions")
    op.drop_column("user_preferences", "profession_scene")
    op.drop_column("user_preferences", "body_concerns")
    op.drop_column("user_preferences", "style_identity")
    op.drop_column("user_preferences", "age_range")
    op.drop_column("user_preferences", "gender")
    op.drop_column("user_preferences", "body_type")
    op.drop_column("user_preferences", "weight_kg")
    op.drop_column("user_preferences", "height_cm")