from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ---- Chat Session ----


class ChatSessionCreate(BaseModel):
    title: str | None = Field(None, max_length=100)
    context: dict | None = None


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str | None = None
    context: dict = {}
    status: str
    created_at: datetime
    updated_at: datetime


class ChatSessionListResponse(BaseModel):
    sessions: list[ChatSessionResponse]
    total: int


# ---- Chat Message ----


class ChatMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_id: UUID
    role: str
    content: str
    metadata: dict = Field(default_factory=dict, validation_alias="extra_metadata")
    created_at: datetime


class ChatSendMessageResponse(BaseModel):
    """Response after sending a message - includes user message + AI reply."""

    user_message: ChatMessageResponse
    ai_message: ChatMessageResponse
    outfit_suggestions: list[dict] | None = None
    confirmed_outfit: dict | None = None
    quick_replies: list[str] | None = None


class ChatMessagesResponse(BaseModel):
    messages: list[ChatMessageResponse]
    total: int


# ---- Onboarding ----


class OnboardingStep1(BaseModel):
    gender: str = Field(..., pattern="^(male|female|non-binary|prefer-not-to-say)$")
    age_range: str = Field(..., pattern="^(18-24|25-30|31-40|40\\+)$")


class OnboardingStep2(BaseModel):
    height_cm: int = Field(..., ge=120, le=230)
    weight_kg: int = Field(..., ge=30, le=200)
    body_type: str = Field(..., pattern="^(slim|standard|athletic|curvy|muscular)$")


class OnboardingStep3(BaseModel):
    style_identity: list[str] = Field(..., min_length=1, max_length=5)
    body_concerns: list[str] = Field(default_factory=list, max_length=5)
    profession_scene: str = Field(..., pattern="^(student|office|freelance|entrepreneur|other)$")


class OnboardingRequest(BaseModel):
    step: int = Field(..., ge=1, le=3)
    data: dict


class OnboardingResponse(BaseModel):
    step: int
    completed: bool
    next_step: int | None = None
