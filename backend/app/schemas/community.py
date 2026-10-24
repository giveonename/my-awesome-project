"""Community help request schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ===== Help Request =====


class HelpRequestCreate(BaseModel):
    """Request body for POST /community/help-requests."""

    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    occasion: str | None = Field(None, max_length=50)
    budget_range: str | None = Field(None, max_length=30)
    style_preference: str | None = Field(None, max_length=100)
    reference_image_urls: list[str] | None = None


class HelpRequestUpdate(BaseModel):
    """Request body for PATCH /community/help-requests/{id}."""

    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    occasion: str | None = None
    budget_range: str | None = None
    style_preference: str | None = None
    reference_image_urls: list[str] | None = None
    status: str | None = Field(None, pattern=r"^(open|in_progress|resolved|closed)$")


class HelpRequestResponse(BaseModel):
    """Response for a help request."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    description: str | None = None
    occasion: str | None = None
    budget_range: str | None = None
    style_preference: str | None = None
    reference_image_urls: list[str] | None = None
    status: str
    reply_count: int = 0
    created_at: datetime
    updated_at: datetime

    # Nested user info (optional, populated in list/detail endpoints)
    user_name: str | None = None
    user_avatar: str | None = None


class HelpRequestListResponse(BaseModel):
    """Paginated list of help requests."""

    items: list[HelpRequestResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


# ===== Help Reply =====


class HelpReplyCreate(BaseModel):
    """Request body for POST /community/help-requests/{id}/replies."""

    content: str = Field(..., min_length=1, max_length=2000)
    suggested_items: list[str] | None = None  # list of item UUIDs
    image_urls: list[str] | None = None


class HelpReplyResponse(BaseModel):
    """Response for a help reply."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    request_id: UUID
    user_id: UUID
    content: str
    suggested_items: list[str] | None = None
    image_urls: list[str] | None = None
    is_accepted: bool = False
    created_at: datetime

    user_name: str | None = None
    user_avatar: str | None = None
