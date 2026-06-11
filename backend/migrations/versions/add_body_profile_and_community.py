"""add body_profiles and community tables

Revision ID: e3f4a5b6c7d8
Revises: b1c2d3e4f5a6, 2bc743c6eefd, 7a3b5c8d9e0f, c3d4e5f6a7b8
Create Date: 2026-05-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e3f4a5b6c7d8"
down_revision: str | Sequence[str] | None = (
    "b1c2d3e4f5a6",
    "2bc743c6eefd",
    "7a3b5c8d9e0f",
    "c3d4e5f6a7b8",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ===== body_profiles =====
    op.create_table(
        "body_profiles",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("height_cm", sa.Float, nullable=True),
        sa.Column("weight_kg", sa.Float, nullable=True),
        sa.Column("body_type", sa.String(30), nullable=True),
        sa.Column("shoulder_type", sa.String(20), nullable=True),
        sa.Column("leg_type", sa.String(20), nullable=True),
        sa.Column("upper_lower_ratio", sa.String(20), nullable=True),
        sa.Column("bust_cm", sa.Float, nullable=True),
        sa.Column("waist_cm", sa.Float, nullable=True),
        sa.Column("hip_cm", sa.Float, nullable=True),
        sa.Column("skin_tone", sa.String(20), nullable=True),
        sa.Column("want_to_improve", postgresql.ARRAY(sa.String), nullable=True),
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_body_profiles_user_id", "body_profiles", ["user_id"])

    # ===== help_requests =====
    op.create_table(
        "help_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("occasion", sa.String(50), nullable=True),
        sa.Column("budget_range", sa.String(30), nullable=True),
        sa.Column("style_preference", sa.String(100), nullable=True),
        sa.Column("reference_image_urls", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(20), server_default="open", nullable=False),
        sa.Column("reply_count", sa.Integer, server_default="0", nullable=False),
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_help_requests_user_id", "help_requests", ["user_id"])
    op.create_index("ix_help_requests_status", "help_requests", ["status"])

    # ===== help_replies =====
    op.create_table(
        "help_replies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("help_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("suggested_items", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("image_urls", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_accepted", sa.Boolean, server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_help_replies_request_id", "help_replies", ["request_id"])
    op.create_index("ix_help_replies_user_id", "help_replies", ["user_id"])


def downgrade() -> None:
    op.drop_table("help_replies")
    op.drop_table("help_requests")
    op.drop_table("body_profiles")
