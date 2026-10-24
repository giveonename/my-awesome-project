import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Color preferences
    color_favorites: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    color_avoid: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)

    # Style preferences
    style_profile: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Occasion settings
    default_occasion: Mapped[str] = mapped_column(String(50), default="casual")
    occasion_preferences: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Temperature/comfort
    temperature_unit: Mapped[str] = mapped_column(String(20), default="celsius")
    temperature_sensitivity: Mapped[str] = mapped_column(String(20), default="normal")
    cold_threshold: Mapped[int] = mapped_column(Integer, default=10)
    hot_threshold: Mapped[int] = mapped_column(Integer, default=25)
    layering_preference: Mapped[str] = mapped_column(String(20), default="moderate")

    # Recommendation settings
    avoid_repeat_days: Mapped[int] = mapped_column(Integer, default=7)
    prefer_underused_items: Mapped[bool] = mapped_column(Boolean, default=True)
    variety_level: Mapped[str] = mapped_column(String(20), default="moderate")

    # Restrictions
    excluded_item_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), default=list
    )
    excluded_combinations: Mapped[list] = mapped_column(JSONB, default=list)

    # Body profile (populated during onboarding)
    height_cm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_kg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    body_type: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # slim/standard/athletic/curvy/muscular
    gender: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # male/female/non-binary/prefer-not-to-say
    age_range: Mapped[str | None] = mapped_column(
        String(10), nullable=True
    )  # 18-24, 25-30, 31-40, 40+
    style_identity: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list
    )  # ["casual","minimalist"]
    body_concerns: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list
    )  # ["look-taller","look-slimmer"]
    profession_scene: Mapped[str | None] = mapped_column(
        String(30), nullable=True
    )  # student/office/freelance/other

    # AI Settings - list of endpoint configs
    # Each endpoint: {url, vision_model, text_model, name, enabled}
    ai_endpoints: Mapped[list] = mapped_column(JSONB, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="preferences")
