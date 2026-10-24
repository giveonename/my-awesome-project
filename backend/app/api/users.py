import logging
from decimal import Decimal
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.body_profile import BodyProfile
from app.models.user import User
from app.schemas.body_profile import BodyProfileResponse, BodyProfileUpdate
from app.services.user_service import UserService
from app.utils.auth import get_current_user
from app.utils.signed_urls import sign_image_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users/me", tags=["Users"])


class OnboardingCompleteResponse(BaseModel):
    onboarding_completed: bool


class UserProfileResponse(BaseModel):
    id: str
    email: str
    display_name: str
    avatar_url: str | None = None
    timezone: str
    location_lat: float | None = None
    location_lon: float | None = None
    location_name: str | None = None
    family_id: str | None = None
    role: str
    onboarding_completed: bool
    body_measurements: dict | None = None


class UserProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=20)
    timezone: str | None = None
    location_lat: Decimal | None = None
    location_lon: Decimal | None = None
    location_name: str | None = None
    body_measurements: dict | None = None

    @field_validator("display_name")
    @classmethod
    def _clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("昵称不能为空")
        return cleaned


@router.get("", response_model=UserProfileResponse)
async def get_profile(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserProfileResponse:
    return _user_response(current_user)


@router.patch("", response_model=UserProfileResponse)
async def update_profile(
    data: UserProfileUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserProfileResponse:
    update_data = data.model_dump(exclude_unset=True)

    if "body_measurements" in update_data and update_data["body_measurements"] is not None:
        numeric_keys = {"chest", "waist", "hips", "inseam", "height", "weight"}
        for key, value in update_data["body_measurements"].items():
            if key in numeric_keys and isinstance(value, (int, float)) and value <= 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"{key} must be a positive number",
                )

    for field, value in update_data.items():
        setattr(current_user, field, value)

    await db.flush()
    await db.refresh(current_user)
    await db.commit()

    return _user_response(current_user)


def _resolve_avatar_url(user: User) -> str | None:
    """Return a display-ready avatar URL.

    Local avatars are stored as storage-relative paths and re-signed on every
    response (signed URLs expire after 1h); legacy http(s) URLs pass through.
    """
    avatar = user.avatar_url
    if avatar and not avatar.startswith(("http://", "https://", "/api/")):
        return sign_image_url(avatar)
    return avatar


def _user_response(user: User) -> UserProfileResponse:
    return UserProfileResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        avatar_url=_resolve_avatar_url(user),
        timezone=user.timezone,
        location_lat=float(user.location_lat) if user.location_lat else None,
        location_lon=float(user.location_lon) if user.location_lon else None,
        location_name=user.location_name,
        family_id=str(user.family_id) if user.family_id else None,
        role=user.role,
        onboarding_completed=user.onboarding_completed,
        body_measurements=user.body_measurements,
    )


MAX_AVATAR_BYTES = 5 * 1024 * 1024


@router.post("/avatar", response_model=UserProfileResponse)
async def upload_avatar(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
) -> UserProfileResponse:
    """Upload/replace the user's avatar (stored locally, served via signed URL)."""
    from app.services.image_service import ImageService

    image_service = ImageService()
    content = await image.read()
    content_type = image.content_type or "application/octet-stream"

    if not content or len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="头像文件无效或超过 5MB",
        )
    if not image_service.validate_image(content, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不支持的图片格式",
        )

    try:
        paths = await image_service.process_and_store(
            user_id=current_user.id,
            image_data=content,
            original_filename="avatar" + (Path(image.filename or "").suffix.lower() or ".jpg"),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None

    # Best-effort cleanup of the previous local avatar file
    old_avatar = current_user.avatar_url
    if old_avatar and not old_avatar.startswith(("http://", "https://", "/api/")):
        try:
            old_path = Path(get_settings().storage_path) / old_avatar.split("?")[0]
            for candidate in (
                old_path,
                old_path.with_name(old_path.stem + "_thumb" + old_path.suffix),
                old_path.with_name(old_path.stem + "_medium" + old_path.suffix),
            ):
                if candidate.exists():
                    candidate.unlink()
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to remove old avatar file: %s", e)

    current_user.avatar_url = paths["image_path"]
    await db.flush()
    await db.refresh(current_user)
    await db.commit()

    logger.info("Avatar updated for user %s", current_user.id)
    return _user_response(current_user)


@router.post("/onboarding/complete", response_model=OnboardingCompleteResponse)
async def complete_onboarding(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OnboardingCompleteResponse:
    user_service = UserService(db)
    await user_service.complete_onboarding(current_user)
    await db.commit()

    return OnboardingCompleteResponse(onboarding_completed=True)


# ===== Body Profile =====


@router.get("/body-profile", response_model=BodyProfileResponse)
async def get_body_profile(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> BodyProfileResponse:
    """Get the current user's body profile."""
    result = await db.execute(select(BodyProfile).where(BodyProfile.user_id == current_user.id))
    profile = result.scalar_one_or_none()

    if not profile:
        # Return empty profile with user_id
        return BodyProfileResponse(user_id=current_user.id)

    return BodyProfileResponse.model_validate(profile)


@router.put("/body-profile", response_model=BodyProfileResponse)
async def upsert_body_profile(
    data: BodyProfileUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> BodyProfileResponse:
    """Create or update the current user's body profile."""
    result = await db.execute(select(BodyProfile).where(BodyProfile.user_id == current_user.id))
    profile = result.scalar_one_or_none()

    if not profile:
        profile = BodyProfile(user_id=current_user.id)
        db.add(profile)

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(profile, field, value)

    await db.flush()
    await db.refresh(profile)

    return BodyProfileResponse.model_validate(profile)
