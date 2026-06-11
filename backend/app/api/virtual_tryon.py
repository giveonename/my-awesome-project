"""Virtual Try-On API endpoints using Alibaba Cloud DashScope OutfitAnyone."""

import logging
import time
from typing import Annotated
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.body_profile import BodyProfile
from app.models.item import ClothingItem
from app.models.user import User
from app.services import virtual_tryon_service
from app.services.virtual_tryon_service import (
    DEFAULT_PERSON_URL,
    DEFAULT_TOP_GARMENT_URL,
    DEFAULT_BOTTOM_GARMENT_URL,
)
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/virtual-tryon", tags=["Virtual Try-On"])


# ===== Request/Response Schemas =====


class TryOnRequest(BaseModel):
    garment_item_ids: list[str]
    model_image_url: str | None = None
    use_plus: bool = True
    use_refiner: bool = False


class TryOnSubmitResponse(BaseModel):
    task_id: str
    status: str
    model_used: str
    message: str


class TryOnStatusResponse(BaseModel):
    task_id: str
    status: str
    image_url: str | None = None
    model_used: str | None = None
    error: str | None = None
    elapsed_seconds: float = 0.0


class TryOnDirectResponse(BaseModel):
    success: bool
    image_url: str | None = None
    task_id: str | None = None
    model_used: str | None = None
    error: str | None = None
    elapsed_seconds: float = 0.0


# ===== Helper =====


async def _ensure_oss_url(item: "ClothingItem") -> str | None:
    """Upload item image to OSS if not already there, return public URL."""
    if not item.image_path:
        return None
    from app.services.oss_service import get_oss_service

    oss = get_oss_service()
    if not oss:
        return None

    settings = get_settings()
    full_path = Path(settings.storage_path) / item.image_path
    if not full_path.exists():
        logger.warning("Image file not found for OSS upload: %s", full_path)
        return None

    ext = full_path.suffix.lower().lstrip(".")
    content_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
    object_key = f"images/{item.image_path}"

    try:
        import asyncio
        url = await asyncio.to_thread(oss.upload_file, str(full_path), object_key, content_type)
        logger.info("On-the-fly OSS upload for item %s: %s", str(item.id)[:8], url[:80])
        return url
    except Exception as e:
        logger.error("On-the-fly OSS upload failed for item %s: %s", str(item.id)[:8], e)
        return None

async def _resolve_garment_items(
    db: AsyncSession,
    item_ids: list[str],
) -> list[dict]:
    """Resolve clothing item IDs to garment info dicts for DashScope API."""
    items_out: list[dict] = []
    persist_map: dict[str, str] = {}  # item_id -> public_url to persist
    for item_id_str in item_ids:
        try:
            item_id = UUID(item_id_str)
        except ValueError:
            logger.warning("Invalid item ID: %s", item_id_str)
            continue

        result = await db.execute(
            select(ClothingItem).where(
                ClothingItem.id == item_id,
                ClothingItem.tryon_ready == True,
            )
        )
        item = result.scalar_one_or_none()
        if not item:
            result = await db.execute(
                select(ClothingItem).where(ClothingItem.id == item_id)
            )
            item = result.scalar_one_or_none()
        if not item:
            logger.warning("Item not found: %s", item_id_str)
            continue

        url = None
        if item.public_url:
            url = item.public_url
        else:
            url = await _ensure_oss_url(item)
            if url:
                persist_map[str(item.id)] = url
            else:
                from app.utils.signed_urls import sign_image_url
                signed = sign_image_url(item.image_path)
                if signed.startswith("http"):
                    url = signed

        if not url:
            logger.warning("Item %s has no accessible public URL", item_id_str)
            continue

        items_out.append({
            "url": url,
            "type": item.type or "",
            "source_scene": item.source_scene or "commodity",
            "name": item.name or "",
        })

    # Batch persist newly-resolved public_urls
    if persist_map:
        try:
            from sqlalchemy import update
            from app.models.item import ClothingItem as CI
            for pid, purl in persist_map.items():
                await db.execute(update(CI).where(CI.id == pid).values(public_url=purl))
            await db.commit()
            logger.info("Persisted public_url for %d items", len(persist_map))
        except Exception as e:
            logger.warning("Failed to persist public_urls: %s", e)

    return items_out


async def _resolve_garment_urls(
    db: AsyncSession,
    item_ids: list[str],
) -> list[str]:
    """Legacy: resolve clothing item IDs to public image URLs."""
    items = await _resolve_garment_items(db, item_ids)
    return [it["url"] for it in items]


# ===== Person image resolution =====


async def _resolve_person_url(
    db: AsyncSession,
    user: User,
    explicit_url: str | None = None,
) -> str:
    """Resolve the person image URL for try-on.

    Priority: explicit model_image_url > user full_body_photo_url > DEFAULT_PERSON_URL
    """
    if explicit_url:
        return explicit_url

    # Check user body profile for full body photo
    result = await db.execute(
        select(BodyProfile.full_body_photo_url).where(BodyProfile.user_id == user.id)
    )
    row = result.scalar_one_or_none()
    if row:
        logger.info("Using user full body photo for try-on: %s", row[:80])
        return row

    logger.info("No user photo available, using default model for try-on")
    return DEFAULT_PERSON_URL


# ===== Endpoints =====


@router.post("", response_model=TryOnDirectResponse)
async def create_tryon(
    request: TryOnRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TryOnDirectResponse:
    """Generate virtual try-on image (waits for result, ~90s for aitryon-plus)."""
    if not request.garment_item_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "请至少选择一件衣物来试穿")
    if len(request.garment_item_ids) > 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "最多同时试穿 3 件衣物")

    garment_items = await _resolve_garment_items(db, request.garment_item_ids)
    if not garment_items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "所选衣物没有可用的图片，请先上传衣物图片")

    # Use smart garment classification (handles parsing-v1 for outfit items)
    garment_input = await virtual_tryon_service.resolve_garment_input(garment_items)
    if not garment_input:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "无法识别衣物类型，请重新选择")

    person_url = await _resolve_person_url(db, current_user, request.model_image_url)
    model_name = "aitryon-plus" if request.use_plus else "aitryon"

    try:
        result = await virtual_tryon_service.virtual_tryon(
            person_image_url=person_url,
            garment_urls=[],
            model=model_name,
            use_refiner=request.use_refiner,
            garment_input=garment_input,
        )
    except Exception as e:
        logger.error("Virtual try-on failed: %s", e, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "虚拟试衣遇到了点状况")

    if not result.success:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, result.error or "生成失败")

    return TryOnDirectResponse(
        success=True,
        image_url=result.image_url,
        task_id=result.task_id,
        model_used=result.model_used,
        elapsed_seconds=result.elapsed_seconds,
    )


@router.post("/submit", response_model=TryOnSubmitResponse)
async def submit_tryon(
    request: TryOnRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TryOnSubmitResponse:
    """Submit async try-on task — returns task_id immediately."""
    if not request.garment_item_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "请至少选择一件衣物来试穿")
    if len(request.garment_item_ids) > 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "最多同时试穿 3 件衣物")

    garment_items = await _resolve_garment_items(db, request.garment_item_ids)
    if not garment_items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "所选衣物没有可用的图片")

    # Use smart garment classification (handles parsing-v1 for outfit items)
    garment_input = await virtual_tryon_service.resolve_garment_input(garment_items)
    if not garment_input:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "无法识别衣物类型，请重新选择")

    person_url = await _resolve_person_url(db, current_user, request.model_image_url)
    model_name = "aitryon-plus" if request.use_plus else "aitryon"

    try:
        task = await virtual_tryon_service.submit_tryon_task(
            person_image_url=person_url,
            garment_urls=[],
            model=model_name,
            garment_input=garment_input,
        )
    except Exception as e:
        logger.error("Virtual tryon submit exception: %s", e, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"试衣服务异常: {str(e)[:100]}")

    if task.status == "FAILED":
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, task.error or "提交失败")

    return TryOnSubmitResponse(
        task_id=task.task_id,
        status=task.status,
        model_used=task.model_used,
        message="任务已提交，正在生成中",
    )


@router.get("/status/{task_id}", response_model=TryOnStatusResponse)
async def get_tryon_status(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> TryOnStatusResponse:
    """Poll try-on task status — single quick check, frontend controls interval."""
    task = await virtual_tryon_service.check_task_once(task_id)

    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在或已过期")

    return TryOnStatusResponse(
        task_id=task.task_id,
        status=task.status,
        image_url=task.image_url,
        model_used=task.model_used,
        error=task.error,
        elapsed_seconds=time.time() - task.created_at if task.created_at else 0,
    )

# ===== Body Photo Upload =====


class BodyPhotoResponse(BaseModel):
    photo_url: str
    message: str


@router.post("/body-photo", response_model=BodyPhotoResponse)
async def upload_body_photo(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    image: UploadFile = File(...),
) -> BodyPhotoResponse:
    """Upload a full body photo for virtual try-on."""
    from app.services.image_service import ImageService
    from app.services.oss_service import get_oss_service
    import asyncio

    image_service = ImageService()
    content_data = await image.read()
    content_type = image.content_type or "application/octet-stream"

    if not image_service.validate_image(content_data, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image format. Supported: JPEG, PNG, WebP",
        )

    # Store the image
    paths = await image_service.process_and_store(
        user_id=current_user.id,
        image_data=content_data,
        original_filename=image.filename or "body_photo.jpg",
    )

    # Upload to OSS for DashScope access
    settings = get_settings()
    full_path = Path(settings.storage_path) / paths["image_path"]
    oss = get_oss_service()
    public_url = None
    if oss and full_path.exists():
        ext = full_path.suffix.lower().lstrip(".")
        ct = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(ext, "image/jpeg")
        public_url = await asyncio.to_thread(
            oss.upload_file, str(full_path), f"images/{paths['image_path']}", ct
        )

    if not public_url:
        from app.utils.signed_urls import sign_image_url
        public_url = sign_image_url(paths["image_path"])

    # Upsert body profile
    result = await db.execute(select(BodyProfile).where(BodyProfile.user_id == current_user.id))
    profile = result.scalar_one_or_none()
    if profile:
        profile.full_body_photo_url = public_url
    else:
        profile = BodyProfile(user_id=current_user.id, full_body_photo_url=public_url)
        db.add(profile)

    await db.commit()
    logger.info("Body photo uploaded for user %s: %s", current_user.id, public_url[:80])

    return BodyPhotoResponse(
        photo_url=public_url,
        message="Full body photo uploaded successfully",
    )


@router.get("/body-photo", response_model=BodyPhotoResponse | None)
async def get_body_photo(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BodyPhotoResponse | None:
    """Get the user current body photo URL."""
    result = await db.execute(
        select(BodyProfile.full_body_photo_url).where(BodyProfile.user_id == current_user.id)
    )
    url = result.scalar_one_or_none()
    if url:
        return BodyPhotoResponse(photo_url=url, message="Body photo exists")
    return None



# ===== Background Swap =====


class BackgroundSwapRequest(BaseModel):
    image_url: str
    background_id: str


class BackgroundListItem(BaseModel):
    id: str
    name: str
    filename: str
    available: bool


@router.get("/backgrounds", response_model=list[BackgroundListItem])
async def list_available_backgrounds() -> list[BackgroundListItem]:
    """List available background templates for try-on results."""
    from app.services.virtual_tryon_service import list_backgrounds
    return [BackgroundListItem(**bg) for bg in list_backgrounds()]



@router.get("/backgrounds/{background_id}/preview")
async def get_background_preview(background_id: str):
    """Serve a background template preview image."""
    from fastapi.responses import FileResponse
    from app.services.virtual_tryon_service import BACKGROUNDS, BACKGROUNDS_DIR

    if background_id not in BACKGROUNDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Background not found")

    path = BACKGROUNDS_DIR / BACKGROUNDS[background_id]
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Background file not found")

    return FileResponse(str(path), media_type="image/png")

@router.post("/swap-background")
async def swap_tryon_background(
    request: BackgroundSwapRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Swap the background of a try-on result image."""
    from fastapi.responses import Response
    from app.services.virtual_tryon_service import swap_background

    try:
        result_bytes = await swap_background(
            image_url=request.image_url,
            background_id=request.background_id,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except Exception as e:
        logger.error("Background swap failed: %s", e, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"背景替换失败: {str(e)[:100]}")

    return Response(content=result_bytes, media_type="image/jpeg")
