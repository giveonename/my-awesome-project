"""Body profile model — one-to-one with User."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class BodyProfile(Base):
    """Detailed body measurements and appearance attributes."""

    __tablename__ = "body_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Basic measurements
    height_cm: Mapped[float | None] = mapped_column(Float)
    weight_kg: Mapped[float | None] = mapped_column(Float)

    # Body shape
    body_type: Mapped[str | None] = mapped_column(
        String(30)
    )  # hourglass, pear, apple, rectangle, inverted-triangle
    shoulder_type: Mapped[str | None] = mapped_column(String(20))  # narrow, normal, broad
    leg_type: Mapped[str | None] = mapped_column(String(20))  # straight, x-leg, o-leg
    upper_lower_ratio: Mapped[str | None] = mapped_column(
        String(20)
    )  # long-torso, balanced, long-legs

    # Detailed measurements (cm)
    bust_cm: Mapped[float | None] = mapped_column(Float)
    waist_cm: Mapped[float | None] = mapped_column(Float)
    hip_cm: Mapped[float | None] = mapped_column(Float)

    # Appearance
    skin_tone: Mapped[str | None] = mapped_column(String(20))  # fair, light, medium, tan, dark

    # Style goals
    want_to_improve: Mapped[list[str] | None] = mapped_column(
        ARRAY(String)
    )  # look-taller, look-slimmer, etc.

    # Full body photo for virtual try-on
    full_body_photo_url: Mapped[str | None] = mapped_column(String(500))

    # Extra data for future extension
    extra: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationship
    user: Mapped[Optional["User"]] = relationship("User", back_populates="body_profile")
