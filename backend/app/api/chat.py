import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.chat import ChatMessage, ChatSession
from app.models.item import ClothingItem
from app.models.outfit import Outfit, OutfitItem, OutfitSource, OutfitStatus
from app.models.user import User
from app.schemas.chat import (
    ChatMessageCreate,
    ChatMessageResponse,
    ChatMessagesResponse,
    ChatSendMessageResponse,
    ChatSessionCreate,
    ChatSessionListResponse,
    ChatSessionResponse,
    OnboardingRequest,
    OnboardingResponse,
    OnboardingStep1,
    OnboardingStep2,
    OnboardingStep3,
)
from app.services.chat_service import ChatService
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])


# ---- Onboarding ----


@router.post("/onboarding", response_model=OnboardingResponse)
async def save_onboarding(
    request: OnboardingRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OnboardingResponse:
    """Save onboarding step data."""
    step = request.step
    data = request.data

    # Validate data against step schema
    step_schemas = {1: OnboardingStep1, 2: OnboardingStep2, 3: OnboardingStep3}
    schema_cls = step_schemas.get(step)
    if not schema_cls:
        raise HTTPException(status_code=400, detail="Invalid step")
    validated = schema_cls.model_validate(data)

    # Get or create preferences
    from app.models.preference import UserPreference

    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == current_user.id)
    )
    prefs = result.scalar_one_or_none()
    if not prefs:
        prefs = UserPreference(user_id=current_user.id)
        db.add(prefs)

    if step == 1:
        prefs.gender = validated.gender
        prefs.age_range = validated.age_range
    elif step == 2:
        prefs.height_cm = validated.height_cm
        prefs.weight_kg = validated.weight_kg
        prefs.body_type = validated.body_type
    elif step == 3:
        prefs.style_identity = validated.style_identity
        prefs.body_concerns = validated.body_concerns
        prefs.profession_scene = validated.profession_scene
        current_user.onboarding_completed = True
    else:
        raise HTTPException(status_code=400, detail="Invalid step")

    await db.commit()

    return OnboardingResponse(
        step=step,
        completed=(step == 3),
        next_step=(step + 1) if step < 3 else None,
    )


# ---- Chat Sessions ----


@router.post("/sessions", response_model=ChatSessionResponse)
async def create_session(
    request: ChatSessionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatSessionResponse:
    """Create a new chat session."""
    service = ChatService(db)
    session = await service.create_session(
        current_user, title=request.title, context=request.context
    )
    await db.commit()
    return session


@router.get("/sessions", response_model=ChatSessionListResponse)
async def list_sessions(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatSessionListResponse:
    """List user's chat sessions."""
    service = ChatService(db)
    sessions, total = await service.get_sessions(current_user.id)
    return ChatSessionListResponse(sessions=sessions, total=total)


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_session(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatSessionResponse:
    """Get chat session details."""
    service = ChatService(db)
    session = await service.get_session(session_id, current_user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/sessions/{session_id}/messages", response_model=ChatMessagesResponse)
async def get_messages(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatMessagesResponse:
    """Get messages for a chat session."""
    # Verify access
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id, ChatSession.user_id == current_user.id
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    service = ChatService(db)
    messages = await service.get_messages(session_id)
    return ChatMessagesResponse(messages=messages, total=len(messages))


@router.post("/sessions/{session_id}/message", response_model=ChatSendMessageResponse)
async def send_message(
    session_id: UUID,
    request: ChatMessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatSendMessageResponse:
    """Send a message and get AI response."""
    await rate_limit_by_user(str(current_user.id), "chat", max_requests=20, window_seconds=60)

    # Load session with user preferences
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id, ChatSession.user_id == current_user.id
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Load user with preferences
    user_result = await db.execute(
        select(User).where(User.id == current_user.id).options(selectinload(User.preferences))
    )
    user = user_result.scalar_one_or_none()

    service = ChatService(db)
    ai_msg = await service.send_message(session, user, request.content)
    await db.commit()

    # Get the user message we just saved
    user_msg_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id, ChatMessage.role == "user")
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    user_msg = user_msg_result.scalar_one()

    outfit_suggestions = (
        ai_msg.extra_metadata.get("outfit_suggestions") if ai_msg.extra_metadata else None
    )

    # Handle [CONFIRMED:N] marker - create actual outfit record
    confirmed_outfit = None
    confirmed_index = (
        ai_msg.extra_metadata.get("confirmed_index") if ai_msg.extra_metadata else None
    )
    if (
        confirmed_index is not None
        and outfit_suggestions
        and confirmed_index < len(outfit_suggestions)
    ):
        suggestion = outfit_suggestions[confirmed_index]
        item_refs = suggestion.get("items", [])
        if item_refs:
            # Fetch user's wardrobe to resolve item references
            items_result = await db.execute(
                select(ClothingItem).where(ClothingItem.user_id == current_user.id)
            )
            all_items = items_result.scalars().all()
            # Build lookup: first 8 chars of UUID -> item
            partial_map = {str(item.id)[:8]: item for item in all_items}
            # Also try full UUID match
            full_map = {str(item.id): item for item in all_items}

            matched_items = []
            for ref in item_refs:
                ref = ref.strip()
                item = full_map.get(ref) or partial_map.get(ref)
                if item:
                    matched_items.append(item)

            if matched_items:
                outfit = Outfit(
                    user_id=current_user.id,
                    occasion="chat",
                    reasoning=suggestion.get("headline") or suggestion.get("reasoning"),
                    source=OutfitSource.manual,
                    status=OutfitStatus.accepted,
                )
                db.add(outfit)
                await db.flush()

                for position, item in enumerate(matched_items):
                    db.add(
                        OutfitItem(
                            outfit_id=outfit.id,
                            item_id=item.id,
                            position=position,
                        )
                    )
                await db.flush()

                confirmed_outfit = {
                    "outfit_id": str(outfit.id),
                    "headline": suggestion.get("headline"),
                    "items": [
                        {
                            "id": str(it.id),
                            "name": it.name,
                            "type": it.type,
                            "primary_color": it.primary_color,
                        }
                        for it in matched_items
                    ],
                }

    return ChatSendMessageResponse(
        user_message=ChatMessageResponse.model_validate(user_msg),
        ai_message=ChatMessageResponse.model_validate(ai_msg),
        outfit_suggestions=outfit_suggestions,
        confirmed_outfit=confirmed_outfit,
        quick_replies=["换一套", "加个配饰", "就穿这套"],
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Delete a chat session."""
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id, ChatSession.user_id == current_user.id
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()
