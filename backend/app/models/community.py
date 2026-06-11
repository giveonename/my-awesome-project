"""Community models — help requests and replies."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class HelpRequest(Base):
    """A user request for outfit help from the community."""

    __tablename__ = "help_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    occasion: Mapped[str | None] = mapped_column(String(50))  # casual, work, date, party, etc.
    budget_range: Mapped[str | None] = mapped_column(String(30))  # low, medium, high, unlimited
    style_preference: Mapped[str | None] = mapped_column(String(100))
    reference_image_urls: Mapped[list[str] | None] = mapped_column(JSONB)  # list of image URLs

    status: Mapped[str] = mapped_column(
        String(20), default="open"
    )  # open, in_progress, resolved, closed
    reply_count: Mapped[int] = mapped_column(Integer, default=0)

    # Metadata
    extra: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id])
    replies: Mapped[list["HelpReply"]] = relationship(
        "HelpReply", back_populates="request", cascade="all, delete-orphan"
    )


class HelpReply(Base):
    """A reply to a help request."""

    __tablename__ = "help_replies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("help_requests.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    content: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_items: Mapped[list[str] | None] = mapped_column(JSONB)  # list of item IDs
    image_urls: Mapped[list[str] | None] = mapped_column(JSONB)

    is_accepted: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    request: Mapped[Optional["HelpRequest"]] = relationship("HelpRequest", back_populates="replies")
    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id])
