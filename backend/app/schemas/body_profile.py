"""Body profile schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class BodyProfileUpdate(BaseModel):
    """Request body for PUT /users/me/body-profile."""

    height_cm: float | None = Field(None, gt=0, le=300)
    weight_kg: float | None = Field(None, gt=0, le=500)
    body_type: str | None = Field(None, max_length=30)
    shoulder_type: str | None = Field(None, max_length=20)
    leg_type: str | None = Field(None, max_length=20)
    upper_lower_ratio: str | None = Field(None, max_length=20)
    bust_cm: float | None = Field(None, gt=0, le=200)
    waist_cm: float | None = Field(None, gt=0, le=200)
    hip_cm: float | None = Field(None, gt=0, le=200)
    skin_tone: str | None = Field(None, max_length=20)
    want_to_improve: list[str] | None = None
    extra: dict | None = None


class BodyProfileResponse(BaseModel):
    """Response for GET /users/me/body-profile."""

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    height_cm: float | None = None
    weight_kg: float | None = None
    body_type: str | None = None
    shoulder_type: str | None = None
    leg_type: str | None = None
    upper_lower_ratio: str | None = None
    bust_cm: float | None = None
    waist_cm: float | None = None
    hip_cm: float | None = None
    skin_tone: str | None = None
    want_to_improve: list[str] | None = None
    extra: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
