"""add_public_url_to_clothing_items

Revision ID: add_public_url
Revises: e3f4a5b6c7d8
Create Date: 2026-06-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_public_url"
down_revision: str | None = "e3f4a5b6c7d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("clothing_items", sa.Column("public_url", sa.String(length=1000), nullable=True))
    op.add_column("clothing_items", sa.Column("public_url_medium", sa.String(length=1000), nullable=True))
    op.add_column("clothing_items", sa.Column("public_url_thumbnail", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("clothing_items", "public_url_thumbnail")
    op.drop_column("clothing_items", "public_url_medium")
    op.drop_column("clothing_items", "public_url")
