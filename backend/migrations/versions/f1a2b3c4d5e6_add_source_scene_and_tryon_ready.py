"""add source_scene and tryon_ready to clothing_items

Revision ID: f1a2b3c4d5e6
Revises: b1c2d3e4f5a6, add_public_url, e1f2g3h4i5j6
Create Date: 2026-06-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = None  # Multi-head merge — set to correct head manually
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "clothing_items",
        sa.Column("source_scene", sa.String(20), server_default="commodity"),
    )
    op.add_column(
        "clothing_items",
        sa.Column("tryon_ready", sa.Boolean(), server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("clothing_items", "tryon_ready")
    op.drop_column("clothing_items", "source_scene")
