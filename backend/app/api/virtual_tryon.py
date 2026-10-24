"""Virtual Try-On API endpoints (DashScope qwen-image-3.0)."""

import asyncio
import logging
import time
from pathlib import Path
from typing import Annotated
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
from app.services.virtual_tryon_service import DEFAULT_PERSON_URL
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/virtual-tryon", tags=["Virtual Try-On"])


async def _keep_tryon_result(
    user_id: UUID, task_id: str, item_ids: list[UUID], person_ref: str
) -> None:
    """Persist a finished interactive try-on as a pool outfit and announce it.

    Deliberately NOT written into the "already shown" ledger: as the newest unseen
    entry it sorts to the FRONT of the pool rotation, so the user meets the fresh
    result in the very next feed. The notice carries the occasion so the suggest
    page can line its filter up before refreshing.
    """
    from sqlalchemy.orm import selectinload

    from app.database import async_session_maker
    from app.models.item import ClothingItem
    from app.models.outfit import Outfit, OutfitItem, OutfitSource
    from app.models.user import User
    from app.services.inapp_notice_service import push_notice
    from app.services.suggest_pool import image_fingerprint, stamp_person
    from app.utils.signed_urls import bare_image_path

    deadline = time.time() + 60 * 60
    task = None
    while time.time() < deadline:
        await asyncio.sleep(5)
        task = await virtual_tryon_service.check_task_once(task_id)
        if not task or task.status == "FAILED":
            return
        if task.status == "SUCCEEDED" and task.image_url:
            break
    if not task or not task.image_url:
        return

    try:
        fingerprint = await asyncio.to_thread(image_fingerprint, person_ref)
        async with async_session_maker() as db:
            user = (
                await db.execute(
                    select(User).where(User.id == user_id).options(selectinload(User.preferences))
                )
            ).scalar_one_or_none()
            occasion = (
                user.preferences.default_occasion
                if user and user.preferences and user.preferences.default_occasion
                else "casual"
            )
            names = [
                (row.name or row.type or "")
                for row in (
                    await db.execute(select(ClothingItem).where(ClothingItem.id.in_(item_ids)))
                )
                .scalars()
                .all()
            ]

            outfit = Outfit(
                user_id=user_id,
                occasion=occasion,
                source=OutfitSource.on_demand,
                model_image_url=bare_image_path(task.image_url),
            )
            db.add(outfit)
            await db.flush()
            for position, item_id in enumerate(item_ids):
                db.add(OutfitItem(outfit_id=outfit.id, item_id=item_id, position=position))
            await db.commit()
            outfit_id = str(outfit.id)

        await stamp_person(user_id, [outfit_id], fingerprint)
        title = "试穿图已生成" + (f"：{' + '.join(n for n in names[:3] if n)}" if names else "")
        await push_notice(
            user_id,
            kind="tryon_ready",
            title=title,
            target="suggest",
            extra={"occasion": occasion},
        )
        logger.info("Interactive try-on kept as pool outfit %s", outfit_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to keep interactive try-on result: %s", e)


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


async def _resolve_garment_items(
    db: AsyncSession,
    item_ids: list[str],
) -> list[dict]:
    """Resolve clothing item IDs to local garment info dicts.

    Try-on generation now consumes local storage refs (base64 upload to the
    model), so no OSS/public URL is required.
    """
    items_out: list[dict] = []
    for item_id_str in item_ids:
        try:
            item_id = UUID(item_id_str)
        except ValueError:
            logger.warning("Invalid item ID: %s", item_id_str)
            continue

        result = await db.execute(
            select(ClothingItem).where(
                ClothingItem.id == item_id,
                ClothingItem.tryon_ready == True,  # noqa: E712
            )
        )
        item = result.scalar_one_or_none()
        if not item:
            result = await db.execute(select(ClothingItem).where(ClothingItem.id == item_id))
            item = result.scalar_one_or_none()
        if not item or not item.image_path:
            logger.warning("Item not found or has no image: %s", item_id_str)
            continue

        items_out.append(
            {
                "ref": item.image_path,
                "type": item.type or "",
                "source_scene": item.source_scene or "commodity",
                "name": item.name or "",
                "primary_color": item.primary_color or "",
            }
        )

    return items_out


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
    """Generate virtual try-on image (waits for result, ~80-100s with qwen-image-3.0)."""
    if not request.garment_item_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "请至少选择一件衣物来试穿")
    if len(request.garment_item_ids) > 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "最多同时试穿 3 件衣物")

    garment_items = await _resolve_garment_items(db, request.garment_item_ids)
    if not garment_items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "所选衣物没有可用的图片，请先上传衣物图片")

    garment_refs, descs, is_outfit = virtual_tryon_service.resolve_tryon_inputs(garment_items)
    if not garment_refs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "无法识别衣物类型，请重新选择")

    person_ref = await _resolve_person_url(db, current_user, request.model_image_url)

    try:
        result = await virtual_tryon_service.virtual_tryon(
            person_ref=person_ref,
            garment_refs=garment_refs,
            descs=descs,
            is_outfit=is_outfit,
            user_id=current_user.id,
        )
    except Exception as e:
        logger.error("Virtual try-on failed: %s", e, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "虚拟试衣遇到了点状况") from e

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

    garment_refs, descs, is_outfit = virtual_tryon_service.resolve_tryon_inputs(garment_items)
    if not garment_refs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "无法识别衣物类型，请重新选择")

    person_ref = await _resolve_person_url(db, current_user, request.model_image_url)

    try:
        task = await virtual_tryon_service.submit_tryon_task(
            person_ref=person_ref,
            garment_refs=garment_refs,
            descs=descs,
            is_outfit=is_outfit,
            user_id=current_user.id,
        )
    except Exception as e:
        logger.error("Virtual tryon submit exception: %s", e, exc_info=True)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, f"试衣服务异常: {str(e)[:100]}"
        ) from e

    if task.status == "FAILED":
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, task.error or "提交失败")

    # 结果落到图库里：即使弹窗等超时/用户退出，成品也会出现在「搭配」页
    asyncio.create_task(
        _keep_tryon_result(
            current_user.id, task.task_id, list(request.garment_item_ids), person_ref
        )
    )

    return TryOnSubmitResponse(
        task_id=task.task_id,
        status=task.status,
        model_used=task.model_used,
        message="任务已提交，正在生成中（通常 1-3 分钟，繁忙时更久）",
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
    import asyncio

    from app.services.image_service import ImageService
    from app.services.oss_service import get_oss_service

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

    # Persist the bare storage path; responses re-sign fresh (see signed_urls).
    from app.utils.signed_urls import bare_image_path

    stored_url = bare_image_path(public_url)

    # Upsert body profile
    result = await db.execute(select(BodyProfile).where(BodyProfile.user_id == current_user.id))
    profile = result.scalar_one_or_none()
    if profile:
        profile.full_body_photo_url = stored_url
    else:
        profile = BodyProfile(user_id=current_user.id, full_body_photo_url=stored_url)
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
    from app.utils.signed_urls import sign_image_url

    result = await db.execute(
        select(BodyProfile.full_body_photo_url).where(BodyProfile.user_id == current_user.id)
    )
    url = result.scalar_one_or_none()
    if url:
        return BodyPhotoResponse(photo_url=sign_image_url(url), message="Body photo exists")
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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except Exception as e:
        logger.error("Background swap failed: %s", e, exc_info=True)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, f"背景替换失败: {str(e)[:100]}"
        ) from e

    return Response(content=result_bytes, media_type="image/jpeg")
