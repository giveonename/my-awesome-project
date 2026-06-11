"""add full_body_photo_url to body_profiles

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-06-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "body_profiles",
        sa.Column("full_body_photo_url", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("body_profiles", "full_body_photo_url")
