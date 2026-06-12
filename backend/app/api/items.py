import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

from arq import create_pool
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.schemas.item import (
    ArchiveRequest,
    BulkAnalyzeRequest,
    BulkAnalyzeResponse,
    BulkDeleteRequest,
    BulkDeleteResponse,
    BulkUploadResponse,
    BulkUploadResult,
    ItemCreate,
    ItemFilter,
    ItemImageResponse,
    ItemListResponse,
    ItemResponse,
    ItemUpdate,
    LogWashRequest,
    LogWearRequest,
    RemoveBackgroundRequest,
    ReorderImagesRequest,
    WashHistoryResponse,
)
from app.services.image_service import ImageService
from app.services.item_service import ItemService
from app.utils.auth import get_current_user
from app.workers.settings import get_redis_settings

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/items", tags=["Items"])

# ---------------------------------------------------------------------------
# SegmentCloth category mapping
# ---------------------------------------------------------------------------
CATEGORY_TO_TYPE: dict[str, str] = {
    "tops": "top",
    "coat": "outerwear",
    "skirt": "skirt",
    "pants": "bottom",
    "bag": "bag",
    "shoes": "shoes",
    "hat": "accessory",
}

CATEGORY_TO_NAME_ZH: dict[str, str] = {
    "tops": "上装",
    "coat": "外套",
    "skirt": "裙装",
    "pants": "裤装",
    "bag": "包袋",
    "shoes": "鞋子",
    "hat": "帽子",
}

TYPE_LABEL_ZH: dict[str, str] = {
    "top": "上衣", "tshirt": "T恤", "shirt": "衬衫", "blouse": "女衬衫",
    "sweater": "毛衣", "jacket": "夹克", "coat": "外套", "vest": "马甲",
    "hoodie": "卫衣", "outerwear": "外套", "pants": "裤子", "jeans": "牛仔裤",
    "shorts": "短裤", "bottom": "下装", "skirt": "裙子", "dress": "连衣裙",
    "shoes": "鞋子", "sneakers": "运动鞋", "boots": "靴子", "sandals": "凉鞋",
    "hat": "帽子", "cap": "鸭舌帽", "scarf": "围巾", "bag": "包包",
    "belt": "腰带", "watch": "手表", "sunglasses": "墨镜", "accessory": "配饰",
    "underwear": "内衣", "socks": "袜子", "unknown": "衣物",
}


@router.get("", response_model=ItemListResponse)
async def list_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    type: str | None = None,
    subtype: str | None = None,
    colors: str | None = None,
    status: str | None = None,
    favorite: bool | None = None,
    needs_wash: bool | None = None,
    is_archived: bool = False,
    search: str | None = None,
    sort_by: str | None = None,
    source_scene: str | None = None,
    tryon_ready: bool | None = None,
    sort_order: str = "desc",
) -> ItemListResponse:
    color_list = colors.split(",") if colors else None



    filters = ItemFilter(
        type=type,
        subtype=subtype,
        colors=color_list,
        status=status,
        favorite=favorite,
        needs_wash=needs_wash,
        is_archived=is_archived,
        source_scene=source_scene,
        tryon_ready=tryon_ready,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    item_service = ItemService(db)
    items, total = await item_service.get_list(
        user_id=current_user.id,
        filters=filters,
        page=page,
        page_size=page_size,
    )

    return ItemListResponse(
        items=[ItemResponse.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
        has_more=(page * page_size) < total,
    )


@router.post("", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
    type: str | None = Form(None),  # Optional - AI will detect if not provided
    subtype: str | None = Form(None),
    name: str | None = Form(None),
    brand: str | None = Form(None),
    notes: str | None = Form(None),
    colors: str | None = Form(None),
    primary_color: str | None = Form(None),
    favorite: bool = Form(False),
) -> ItemResponse:
    # Validate and process image
    image_service = ImageService()
    item_service = ItemService(db)

    content = await image.read()
    content_type = image.content_type or "application/octet-stream"

    if not image_service.validate_image(content, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file. Supported formats: JPEG, PNG, WebP, HEIC",
        )

    # Compute hash and check for duplicates BEFORE storing
    try:
        image_hash = image_service.compute_phash(content, image.filename or "upload.jpg")
        existing = await item_service.find_duplicate_by_hash(current_user.id, image_hash)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Duplicate image detected. This item already exists in your wardrobe (ID: {existing.id})",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Failed to compute image hash: {e}")
        # Continue without duplicate check if hash computation fails

    # Process and store image
    try:
        image_paths = await image_service.process_and_store(
            user_id=current_user.id,
            image_data=content,
            original_filename=image.filename or "upload.jpg",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None

    # Parse colors from comma-separated string
    color_list = colors.split(",") if colors else None

    # Create item - use "unknown" if type not provided (AI will detect)
    item_data = ItemCreate(
        type=type or "unknown",
        subtype=subtype,
        name=name,
        brand=brand,
        notes=notes,
        colors=color_list,
        primary_color=primary_color,
        favorite=favorite,
    )

    item = await item_service.create(
        user_id=current_user.id,
        item_data=item_data,
        image_paths=image_paths,
    )

    # Queue AI tagging job
    try:
        redis = await create_pool(get_redis_settings())
        try:
            full_image_path = f"{settings.storage_path}/{image_paths['image_path']}"
            await redis.enqueue_job(
                "tag_item_image",
                str(item.id),
                full_image_path,
                _queue_name="arq:tagging",
            )
            logger.info(f"Queued AI tagging job for item {item.id}")
        finally:
            await redis.aclose()
    except Exception as e:
        # Don't fail the upload if queueing fails
        logger.error(f"Failed to queue AI tagging job: {e}")

    # Save OSS public URLs if available
    if image_paths.get("public_url"):
        item.public_url = image_paths.get("public_url")
        item.public_url_medium = image_paths.get("public_url_medium")
        item.public_url_thumbnail = image_paths.get("public_url_thumbnail")
        await db.flush()

    return ItemResponse.model_validate(item)


@router.post("/bulk", response_model=BulkUploadResponse, status_code=status.HTTP_201_CREATED)
async def bulk_create_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    images: list[UploadFile] = File(..., description="Multiple image files to upload"),
) -> BulkUploadResponse:
    if len(images) > 20:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 20 images per bulk upload",
        )

    if len(images) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one image is required",
        )

    image_service = ImageService()
    item_service = ItemService(db)
    results: list[BulkUploadResult] = []
    successful = 0
    failed = 0

    # Create Redis pool once for all jobs
    redis = None
    try:
        redis = await create_pool(get_redis_settings())
    except Exception as e:
        logger.error(f"Failed to connect to Redis for bulk upload: {e}")

    try:
        for upload_file in images:
            filename = upload_file.filename or "unknown.jpg"

            try:
                # Read and validate image
                content = await upload_file.read()
                content_type = upload_file.content_type or "application/octet-stream"

                if not image_service.validate_image(content, content_type):
                    results.append(
                        BulkUploadResult(
                            filename=filename,
                            success=False,
                            error="Invalid image format. Supported: JPEG, PNG, WebP, HEIC",
                        )
                    )
                    failed += 1
                    continue

                # Check for duplicates BEFORE storing
                try:
                    image_hash = image_service.compute_phash(content, filename)
                    existing = await item_service.find_duplicate_by_hash(
                        current_user.id, image_hash
                    )
                    if existing:
                        results.append(
                            BulkUploadResult(
                                filename=filename,
                                success=False,
                                error="Duplicate image - already exists in wardrobe",
                            )
                        )
                        failed += 1
                        continue
                except Exception as e:
                    logger.warning(f"Failed to check duplicate for {filename}: {e}")
                    # Continue without duplicate check

                # Process and store image
                image_paths = await image_service.process_and_store(
                    user_id=current_user.id,
                    image_data=content,
                    original_filename=filename,
                )

                # Create item with unknown type (AI will detect)
                item_data = ItemCreate(type="unknown")
                item = await item_service.create(
                    user_id=current_user.id,
                    item_data=item_data,
                    image_paths=image_paths,
                )

                # Queue AI tagging job
                if redis:
                    try:
                        full_image_path = f"{settings.storage_path}/{image_paths['image_path']}"
                        await redis.enqueue_job(
                            "tag_item_image",
                            str(item.id),
                            full_image_path,
                            _queue_name="arq:tagging",
                        )
                        logger.info(f"Queued AI tagging for bulk item {item.id}")
                    except Exception as e:
                        logger.error(f"Failed to queue AI tagging for {item.id}: {e}")

                results.append(
                    BulkUploadResult(
                        filename=filename,
                        success=True,
                        item=ItemResponse.model_validate(item),
                    )
                )
                successful += 1

            except ValueError as e:
                results.append(
                    BulkUploadResult(
                        filename=filename,
                        success=False,
                        error=str(e),
                    )
                )
                failed += 1
            except Exception as e:
                logger.error(f"Error processing {filename}: {e}")
                results.append(
                    BulkUploadResult(
                        filename=filename,
                        success=False,
                        error="Failed to process image",
                    )
                )
                failed += 1
    finally:
        if redis:
            await redis.aclose()

    return BulkUploadResponse(
        total=len(images),
        successful=successful,
        failed=failed,
        results=results,
    )


@router.post("/bulk/delete", response_model=BulkDeleteResponse)
async def bulk_delete_items(
    request: BulkDeleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> BulkDeleteResponse:
    item_service = ItemService(db)
    image_service = ImageService()
    deleted = 0
    failed = 0
    errors: list[str] = []

    # Get item IDs to delete
    if request.select_all:
        # Get all items matching filters, excluding specified ones
        item_ids = await item_service.get_ids_by_filter(
            user_id=current_user.id,
            type_filter=request.filters.type if request.filters else None,
            search=request.filters.search if request.filters else None,
            is_archived=request.filters.is_archived
            if request.filters and request.filters.is_archived is not None
            else False,
            excluded_ids=list(request.excluded_ids) if request.excluded_ids else None,
        )
        logger.info(f"Bulk delete select_all: {len(item_ids)} items to delete")
    else:
        item_ids = request.item_ids or []

    for item_id in item_ids:
        try:
            item = await item_service.get_by_id(item_id, current_user.id)
            if not item:
                errors.append(f"Item {item_id} not found or not owned by user")
                failed += 1
                continue

            # Delete images
            image_service.delete_images(
                {
                    "image_path": item.image_path,
                    "medium_path": item.medium_path,
                    "thumbnail_path": item.thumbnail_path,
                }
            )

            await item_service.delete(item)
            deleted += 1
        except Exception as e:
            logger.error(f"Failed to delete item {item_id}: {e}")
            errors.append(f"Failed to delete item {item_id}")
            failed += 1

    return BulkDeleteResponse(deleted=deleted, failed=failed, errors=errors)


@router.post("/bulk/analyze", response_model=BulkAnalyzeResponse)
async def bulk_analyze_items(
    request: BulkAnalyzeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> BulkAnalyzeResponse:
    from app.models.item import ItemStatus

    item_service = ItemService(db)
    queued = 0
    failed = 0
    errors: list[str] = []

    # Get item IDs to analyze
    if request.select_all:
        item_ids = await item_service.get_ids_by_filter(
            user_id=current_user.id,
            type_filter=request.filters.type if request.filters else None,
            search=request.filters.search if request.filters else None,
            is_archived=request.filters.is_archived
            if request.filters and request.filters.is_archived is not None
            else False,
            excluded_ids=list(request.excluded_ids) if request.excluded_ids else None,
        )
        logger.info(f"Bulk analyze select_all: {len(item_ids)} items to analyze")
    else:
        item_ids = request.item_ids or []

    # Collect valid items first
    items_to_process = []
    for item_id in item_ids:
        item = await item_service.get_by_id(item_id, current_user.id)
        if not item:
            errors.append(f"Item {item_id} not found or not owned by user")
            failed += 1
            continue
        items_to_process.append(item)

    # Set all items to processing status
    for item in items_to_process:
        item.status = ItemStatus.processing
    await db.commit()

    # Queue AI jobs
    redis = None
    try:
        redis = await create_pool(get_redis_settings())
    except Exception as e:
        logger.error(f"Failed to connect to Redis for bulk analyze: {e}")
        # Roll back status changes
        for item in items_to_process:
            item.status = ItemStatus.error
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to connect to job queue",
        ) from None

    try:
        for item in items_to_process:
            try:
                full_image_path = f"{settings.storage_path}/{item.image_path}"
                await redis.enqueue_job(
                    "tag_item_image",
                    str(item.id),
                    full_image_path,
                    _queue_name="arq:tagging",
                )
                logger.info(f"Queued AI re-analysis for item {item.id}")
                queued += 1
            except Exception as e:
                logger.error(f"Failed to queue AI analysis for {item.id}: {e}")
                errors.append(f"Failed to queue analysis for item {item.id}")
                item.status = ItemStatus.error
                failed += 1

        await db.commit()
    finally:
        if redis:
            await redis.aclose()

    return BulkAnalyzeResponse(queued=queued, failed=failed, errors=errors)


@router.get("/types")
async def get_item_types(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    item_service = ItemService(db)
    return await item_service.get_item_types(current_user.id)


@router.get("/colors")
async def get_color_distribution(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    item_service = ItemService(db)
    return await item_service.get_color_distribution(current_user.id)


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    return ItemResponse.model_validate(item)


@router.patch("/{item_id}", response_model=ItemResponse)
async def update_item(
    item_id: UUID,
    item_data: ItemUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    item = await item_service.update(item, item_data)
    return ItemResponse.model_validate(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    # Delete images
    image_service = ImageService()
    image_service.delete_images(
        {
            "image_path": item.image_path,
            "medium_path": item.medium_path,
            "thumbnail_path": item.thumbnail_path,
        }
    )

    await item_service.delete(item)


@router.post("/{item_id}/archive", response_model=ItemResponse)
async def archive_item(
    item_id: UUID,
    request: ArchiveRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    item = await item_service.archive(item, request.reason)
    return ItemResponse.model_validate(item)


@router.post("/{item_id}/restore", response_model=ItemResponse)
async def restore_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    item = await item_service.restore(item)
    return ItemResponse.model_validate(item)


@router.post("/{item_id}/wear", response_model=ItemResponse)
async def log_item_wear(
    item_id: UUID,
    request: LogWearRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    # Use user's timezone to determine today if worn_at not provided
    if request.worn_at is None:
        try:
            user_tz = ZoneInfo(current_user.timezone or "UTC")
        except Exception:
            user_tz = ZoneInfo("UTC")
        worn_at = datetime.now(UTC).astimezone(user_tz).date()
    else:
        worn_at = request.worn_at

    await item_service.log_wear(
        item=item,
        worn_at=worn_at,
        occasion=request.occasion,
        notes=request.notes,
    )

    # Refresh to get updated wear_count
    await db.refresh(item)
    return ItemResponse.model_validate(item)


@router.get("/{item_id}/history")
async def get_item_history(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(10, ge=1, le=100),
) -> list[dict]:
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload

    from app.models.item import ItemHistory
    from app.models.outfit import Outfit, OutfitItem

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    # Eagerly load outfit and its items for context
    result = await db.execute(
        sa_select(ItemHistory)
        .where(ItemHistory.item_id == item_id)
        .options(
            selectinload(ItemHistory.outfit)
            .selectinload(Outfit.items)
            .selectinload(OutfitItem.item)
        )
        .order_by(ItemHistory.worn_at.desc())
        .limit(limit)
    )
    history = list(result.scalars().all())

    entries = []
    for h in history:
        entry = {
            "id": str(h.id),
            "worn_at": h.worn_at.isoformat(),
            "occasion": h.occasion,
            "notes": h.notes,
        }
        if h.outfit:
            from app.utils.signed_urls import sign_image_url

            entry["outfit"] = {
                "id": str(h.outfit.id),
                "occasion": h.outfit.occasion,
                "items": [
                    {
                        "id": str(oi.item.id),
                        "type": oi.item.type,
                        "name": oi.item.name,
                        "thumbnail_url": sign_image_url(oi.item.thumbnail_path)
                        if oi.item.thumbnail_path
                        else None,
                    }
                    for oi in sorted(h.outfit.items, key=lambda x: x.position)
                ],
            }
        entries.append(entry)

    return entries


@router.get("/{item_id}/wear-stats")
async def get_item_wear_stats(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    return await item_service.get_wear_stats(item, current_user.timezone or "UTC")


@router.post("/{item_id}/wash", response_model=ItemResponse)
async def log_item_wash(
    item_id: UUID,
    request: LogWashRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if item.wears_since_wash == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Item is already clean (0 wears since last wash)",
        )

    # Use user's timezone to determine today if washed_at not provided
    if request.washed_at is None:
        try:
            user_tz = ZoneInfo(current_user.timezone or "UTC")
        except Exception:
            user_tz = ZoneInfo("UTC")
        washed_at = datetime.now(UTC).astimezone(user_tz).date()
    else:
        washed_at = request.washed_at

    await item_service.log_wash(
        item=item,
        washed_at=washed_at,
        method=request.method,
        notes=request.notes,
    )

    await db.refresh(item)
    return ItemResponse.model_validate(item)


@router.get("/{item_id}/wash-history", response_model=list[WashHistoryResponse])
async def get_item_wash_history(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(10, ge=1, le=100),
) -> list[WashHistoryResponse]:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    history = await item_service.get_wash_history(item_id, limit)
    return [WashHistoryResponse.model_validate(h) for h in history]


@router.post("/{item_id}/analyze", response_model=dict)
async def trigger_ai_analysis(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    try:
        # Set item status to processing so UI shows feedback
        from app.models.item import ItemStatus

        item.status = ItemStatus.processing
        await db.commit()

        redis = await create_pool(get_redis_settings())
        try:
            full_image_path = f"{settings.storage_path}/{item.image_path}"
            job = await redis.enqueue_job(
                "tag_item_image",
                str(item.id),
                full_image_path,
                _queue_name="arq:tagging",
            )
            logger.info(f"Queued AI re-analysis job for item {item.id}")
            return {"status": "queued", "job_id": job.job_id}
        finally:
            await redis.aclose()
    except Exception as e:
        logger.error(f"Failed to queue AI analysis job: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to queue AI analysis",
        ) from None


@router.post("/{item_id}/rotate", response_model=ItemResponse)
async def rotate_item_image(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    direction: str = Query(
        "cw",
        regex="^(cw|ccw)$",
        description="Rotation direction: cw (clockwise) or ccw (counter-clockwise)",
    ),
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if not item.image_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Item has no image",
        )

    try:
        image_service = ImageService()
        image_service.rotate_image(item.image_path, direction)
        await db.commit()
        await db.refresh(item)
        return ItemResponse.model_validate(item)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None
    except Exception as e:
        logger.error(f"Failed to rotate image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to rotate image",
        ) from None


@router.post("/{item_id}/remove-background", response_model=ItemResponse)
async def remove_item_background(
    item_id: UUID,
    request: RemoveBackgroundRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if not item.image_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Item has no image",
        )

    hex_color = request.bg_color.lstrip("#")
    bg_color = tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))

    try:
        image_service = ImageService()
        await asyncio.to_thread(image_service.remove_background, item.image_path, bg_color)
        await db.commit()
        await db.refresh(item)
        return ItemResponse.model_validate(item)
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Background removal provider not available. "
            "For rembg: pip install rembg[cpu]. "
            "For HTTP provider: set BG_REMOVAL_PROVIDER=http and BG_REMOVAL_URL.",
        ) from None
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None
    except Exception as e:
        logger.error(f"Failed to remove background: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove background",
        ) from None


@router.post(
    "/{item_id}/images", response_model=ItemImageResponse, status_code=status.HTTP_201_CREATED
)
async def add_item_image(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
) -> ItemImageResponse:
    from app.models.item import ItemImage

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    # Check max images limit
    from sqlalchemy import func, select

    count_result = await db.execute(select(func.count()).where(ItemImage.item_id == item_id))
    current_count = count_result.scalar() or 0
    if current_count >= 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum of 4 additional images per item",
        )

    # Process image
    image_service_inst = ImageService()
    content = await image.read()
    content_type = image.content_type or "application/octet-stream"

    if not image_service_inst.validate_image(content, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file. Supported formats: JPEG, PNG, WebP, HEIC",
        )

    try:
        image_paths = await image_service_inst.process_and_store(
            user_id=current_user.id,
            image_data=content,
            original_filename=image.filename or "upload.jpg",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None

    item_image = ItemImage(
        item_id=item_id,
        image_path=image_paths["image_path"],
        thumbnail_path=image_paths.get("thumbnail_path"),
        medium_path=image_paths.get("medium_path"),
        position=current_count,
    )
    db.add(item_image)
    await db.flush()
    await db.refresh(item_image)

    return ItemImageResponse.model_validate(item_image)


@router.delete("/{item_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item_image(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    from sqlalchemy import select

    from app.models.item import ItemImage

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    result = await db.execute(
        select(ItemImage).where(ItemImage.id == image_id, ItemImage.item_id == item_id)
    )
    item_image = result.scalar_one_or_none()

    if not item_image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    # Delete image files
    image_service_inst = ImageService()
    image_service_inst.delete_images(
        {
            "image_path": item_image.image_path,
            "medium_path": item_image.medium_path,
            "thumbnail_path": item_image.thumbnail_path,
        }
    )

    await db.delete(item_image)
    await db.flush()


@router.patch("/{item_id}/images/reorder", response_model=list[ItemImageResponse])
async def reorder_item_images(
    item_id: UUID,
    request: ReorderImagesRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[ItemImageResponse]:
    from sqlalchemy import select

    from app.models.item import ItemImage

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    result = await db.execute(select(ItemImage).where(ItemImage.item_id == item_id))
    images = {img.id: img for img in result.scalars().all()}

    for position, img_id in enumerate(request.image_ids):
        if img_id in images:
            images[img_id].position = position

    await db.flush()

    # Return in new order
    ordered = sorted(images.values(), key=lambda x: x.position)
    return [ItemImageResponse.model_validate(img) for img in ordered]


@router.post("/{item_id}/images/{image_id}/set-primary", response_model=ItemResponse)
async def set_primary_image(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    from sqlalchemy import select

    from app.models.item import ItemImage

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    result = await db.execute(
        select(ItemImage).where(ItemImage.id == image_id, ItemImage.item_id == item_id)
    )
    item_image = result.scalar_one_or_none()

    if not item_image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    # Swap paths: current primary -> additional, additional -> primary
    old_primary = {
        "image_path": item.image_path,
        "thumbnail_path": item.thumbnail_path,
        "medium_path": item.medium_path,
    }

    item.image_path = item_image.image_path
    item.thumbnail_path = item_image.thumbnail_path
    item.medium_path = item_image.medium_path

    item_image.image_path = old_primary["image_path"]
    item_image.thumbnail_path = old_primary["thumbnail_path"]
    item_image.medium_path = old_primary["medium_path"]

    await db.flush()
    await db.refresh(item)
    return ItemResponse.model_validate(item)

# ===== Parse: synchronous AI analysis =====


class ParsedItemResult(BaseModel):
    name: str
    type: str
    primary_color: str | None = None
    material: str | None = None
    style: list[str] = []
    description: str | None = None
    confidence: float = 0.0
    category: str | None = None
    segmented_image_path: str | None = None
    thumbnail_url: str | None = None
    source_scene: str | None = None
    tryon_ready: bool = False


class ParseResponse(BaseModel):
    items: list[ParsedItemResult]
    count: int
    image_path: str | None = None


class FromParseRequest(BaseModel):
    """Request to create items from a previous parse result."""
    items: list[ParsedItemResult]
    image_path: str | None = None
    primary_color: str | None = None
    material: str | None = None
    style: list[str] = []
    scene_type: str = "commodity"


class FromParseResponse(BaseModel):
    created: int
    failed: int
    item_ids: list[str] = []
    errors: list[str] = []


async def _enrich_segmented_items(
    items: list[ParsedItemResult],
    ai_service_instance: "AIService",
    base_storage: str,
) -> list[ParsedItemResult]:
    """Enrich segmented items with AI-recognized tags (type, name, color, etc.).
    
    Special case: when there's only 1 segment (e.g. stacked items that couldn't be split),
    use analyze_image_multi to detect ALL items in the image and create multiple results.
    """
    if len(items) == 1 and items[0].segmented_image_path:
        # Single segment — try multi-item detection
        full_seg_path = f"{base_storage}/{items[0].segmented_image_path}"
        try:
            all_tags = await ai_service_instance.analyze_image_multi(full_seg_path)
            if len(all_tags) > 1:
                # Multiple items found in single image — create separate results
                enriched = []
                for tags in all_tags:
                    item = ParsedItemResult(
                        name=tags.name or tags.type or "未命名单品",
                        type=tags.type or "unknown",
                        primary_color=tags.primary_color,
                        material=tags.material,
                        style=tags.style or [],
                        description=tags.description,
                        confidence=tags.confidence or 0.8,
                        segmented_image_path=items[0].segmented_image_path,
                        thumbnail_url=items[0].thumbnail_url,
                        category=items[0].category,
                    )
                    enriched.append(item)
                return enriched
        except Exception as e:
            logger.warning("Multi-item detection failed for single segment: %s", e)
    
    # Standard: enrich each segment individually
    for item in items:
        seg_path = item.segmented_image_path
        if not seg_path:
            continue
        full_seg_path = f"{base_storage}/{seg_path}"
        try:
            tags = await ai_service_instance.analyze_image(full_seg_path)
            if tags.type and tags.type != "unknown":
                item.type = tags.type
            if tags.name:
                item.name = tags.name
            if tags.primary_color:
                item.primary_color = tags.primary_color
            if tags.material:
                item.material = tags.material
            if tags.style:
                item.style = tags.style
            if tags.description:
                item.description = tags.description
            if tags.confidence > item.confidence:
                item.confidence = tags.confidence
        except Exception as e:
            logger.warning("AI enrichment failed for segment %s: %s", seg_path, e)
    return items


@router.post("/parse", response_model=ParseResponse)
async def parse_items_from_image(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
    scene_type: str = Form("", description="commodity/avatar/empty=auto"),
) -> ParseResponse:
    """Synchronously analyze an image for clothing items using AI.

    When ``scene_type`` is ``"avatar"`` (穿搭照), the endpoint also runs
    SegmentCloth to separate each garment into its own transparent PNG,
    then uses MiMo AI to enrich each segment with detailed tags.
    """
    from app.services.ai_service import AIService
    from app.services.aliyun_vision_service import AliyunVisionService
    from app.utils.signed_urls import sign_image_url

    image_service = ImageService()

    content = await image.read()
    content_type = image.content_type or "application/octet-stream"

    if not image_service.validate_image(content, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file. Supported formats: JPEG, PNG, WebP, HEIC",
        )

    try:
        image_paths = await image_service.process_and_store(
            user_id=current_user.id,
            image_data=content,
            original_filename=image.filename or "upload.jpg",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None

    full_image_path = f"{settings.storage_path}/{image_paths['image_path']}"
    print(f"PARSE_DEBUG: scene_type={scene_type}, image={full_image_path}")

    results: list[ParsedItemResult] = []

    # ---------------------------------------------------------------
    # Path A: Scene-based primary processing
    # ---------------------------------------------------------------
    # Auto-classify using MiMo vision model
    if not scene_type:
        from app.services.ai_service import AIService as _AISvc
        from app.models.preference import UserPreference
        from sqlalchemy import select as _select
        _pref_result = await db.execute(
            _select(UserPreference).where(UserPreference.user_id == current_user.id)
        )
        _pref = _pref_result.scalar_one_or_none()
        _user_eps = _pref.ai_endpoints if _pref and _pref.ai_endpoints else []
        _ai_svc = _AISvc()
        scene_type = await _ai_svc.classify_image_type(full_image_path, user_endpoints=_user_eps)
        if scene_type == "flat_lay":
            scene_type = "commodity"
        print(f"AUTO_CLASSIFY_RESULT: {scene_type}")

    if scene_type == "commodity":
        # Flat-lay photo: background removal + connected-component splitting
        # Each separated garment → individual item in wardrobe
        try:
            vision_service = AliyunVisionService()
            # Single AI call on the ORIGINAL image to get all tags at once
            ai_svc = AIService()
            full_image_path = f"{settings.storage_path}/{image_paths['image_path']}"
            tags_list = await ai_svc.analyze_image_multi(full_image_path)
            logger.info(
                "AI detected %d items in commodity image", len(tags_list),
            )

            # SegmentCommodity + PIL connected-component splitting
            split_items = await vision_service.segment_commodity_items(content)
            logger.info(
                "segment_commodity_items produced %d regions", len(split_items),
            )

            # Store all segments in parallel
            segment_keys = list(split_items.keys())
            segment_bytes_list = [split_items[k] for k in segment_keys]
            store_tasks = [
                image_service.process_and_store_png(
                    user_id=current_user.id,
                    image_data=seg_bytes,
                    original_filename=f"commodity_{seg_key}.png",
                )
                for seg_key, seg_bytes in zip(segment_keys, segment_bytes_list)
            ]
            stored_paths_list = await asyncio.gather(*store_tasks, return_exceptions=True)

            # Match stored segments to AI tags by index
            for idx, (seg_key, stored_paths) in enumerate(
                zip(segment_keys, stored_paths_list)
            ):
                if isinstance(stored_paths, Exception):
                    logger.warning(
                        "Failed to store segment '%s': %s", seg_key, stored_paths,
                    )
                    continue

                result_item = ParsedItemResult(
                    name=f"衣物 {idx + 1}",
                    type="unknown",
                    category="commodity",
                    segmented_image_path=stored_paths.get("image_path"),
                    thumbnail_url=sign_image_url(stored_paths.get("thumbnail_path"))
                    if stored_paths.get("thumbnail_path") else None,
                    confidence=0.85,
                )

                # Match with AI tags if available
                if idx < len(tags_list):
                    tags = tags_list[idx]
                    if tags.name:
                        result_item.name = tags.name
                    if tags.type and tags.type != "unknown":
                        result_item.type = tags.type
                    if tags.primary_color:
                        result_item.primary_color = tags.primary_color
                    if tags.material:
                        result_item.material = tags.material
                    if tags.style:
                        result_item.style = tags.style
                    if tags.description:
                        result_item.description = tags.description
                    result_item.confidence = tags.confidence or 0.85

                result_item.source_scene = "commodity"
                result_item.tryon_ready = False
                results.append(result_item)

            # Fallback: if splitting yielded nothing, use AI tags directly
            if not results and tags_list:
                logger.info(
                    "segment_commodity_items returned 0 regions, "
                    "using AI tags as fallback",
                )
                for tags in tags_list:
                    result_item = ParsedItemResult(
                        name=tags.name or tags.type or "未命名单品",
                        type=tags.type or "unknown",
                        primary_color=tags.primary_color,
                        material=tags.material,
                        style=tags.style or [],
                        description=tags.description,
                        confidence=tags.confidence,
                        category="commodity",
                        source_scene="commodity",
                        tryon_ready=False,
                    )
                    results.append(result_item)

            print(
                f'PARSE_RESULT: commodity count={len(results)}, '
                f'types={[r.type for r in results]}, names={[r.name for r in results]}'
            )
            return ParseResponse(
                items=results,
                count=len(results),
                image_path=image_paths.get("image_path"),
            )
        except Exception as exc:
            logger.warning("Commodity segmentation failed: %s, falling through to AI", exc)

    elif scene_type == "avatar":
        # Avatar: SegmentCloth full_body + parsing-v1 top/bottom split
        try:
            import time as _time
            import httpx as _httpx
            avatar_t0 = _time.perf_counter()

            vision_service = AliyunVisionService()
            avatar_layers = await vision_service.parse_avatar(content)
            logger.info(
                "parse_avatar finished in %.2fs, layers=%s",
                _time.perf_counter() - avatar_t0,
                list(avatar_layers.keys()) if avatar_layers else [],
            )

            # Pick full_body layer
            seg_bytes = None
            for key in ("full_body", "tops", "upper_body"):
                if key in avatar_layers:
                    seg_bytes = avatar_layers[key]
                    break
            if not seg_bytes and avatar_layers:
                seg_bytes = next(iter(avatar_layers.values()))

            if seg_bytes:
                fb_paths = await image_service.process_and_store_png(
                    user_id=current_user.id,
                    image_data=seg_bytes,
                    original_filename="avatar_full_body.png",
                )
                results.append(ParsedItemResult(
                    name="穿搭照",
                    type="outfit",
                    category="full_body",
                    segmented_image_path=fb_paths.get("image_path"),
                    thumbnail_url=sign_image_url(fb_paths.get("thumbnail_path"))
                    if fb_paths.get("thumbnail_path") else None,
                    confidence=0.9,
                    source_scene="avatar",
                    tryon_ready=True,
                ))

                # --- parsing-v1: split full_body into top + bottom ---
                try:
                    from app.services.virtual_tryon_service import parse_garment_regions
                    # Need a public URL for parsing-v1 API
                    fb_public_url = fb_paths.get("public_url")
                    if not fb_public_url:
                        # Fallback: upload to OSS on the fly
                        from app.services.oss_service import get_oss_service
                        oss = get_oss_service()
                        if oss:
                            import asyncio as _aio
                            fb_full_path = Path(settings.storage_path) / fb_paths.get("image_path", "")
                            if fb_full_path.exists():
                                fb_public_url = await _aio.to_thread(
                                    oss.upload_file,
                                    str(fb_full_path),
                                    f"images/{fb_paths.get('image_path', '')}",
                                    "image/png",
                                )

                    if fb_public_url:
                        parsed = await parse_garment_regions(fb_public_url)
                        crop_urls = parsed.get("crop_img_url", [])
                        logger.info(
                            "parsing-v1 returned %d crop URLs: %s",
                            len(crop_urls),
                            [u[:60] for u in crop_urls],
                        )

                        # Map parsing-v1 crops to garment types
                        # parsing-v1 returns crops in order: upper, lower
                        crop_type_map = [
                            ("上装", "top", "upper"),
                            ("下装", "pants", "lower"),
                        ]

                        for i, crop_url in enumerate(crop_urls):
                            if i >= len(crop_type_map):
                                break
                            item_name, item_type, category = crop_type_map[i]

                            # Download crop image
                            try:
                                async with _httpx.AsyncClient(timeout=30.0) as dl_client:
                                    dl_resp = await dl_client.get(crop_url)
                                    if dl_resp.status_code == 200 and len(dl_resp.content) > 500:
                                        crop_paths = await image_service.process_and_store_png(
                                            user_id=current_user.id,
                                            image_data=dl_resp.content,
                                            original_filename=f"avatar_{item_type}.png",
                                        )
                                        results.append(ParsedItemResult(
                                            name=item_name,
                                            type=item_type,
                                            category=category,
                                            segmented_image_path=crop_paths.get("image_path"),
                                            thumbnail_url=sign_image_url(crop_paths.get("thumbnail_path"))
                                            if crop_paths.get("thumbnail_path") else None,
                                            confidence=0.85,
                                            source_scene="commodity",
                                            tryon_ready=False,
                                        ))
                                        logger.info("Avatar parsing-v1: stored %s crop", item_type)
                                    else:
                                        logger.warning("Failed to download %s crop: status=%d size=%d",
                                                       item_type, dl_resp.status_code, len(dl_resp.content))
                            except Exception as dl_exc:
                                logger.warning("Download %s crop failed: %s", item_type, dl_exc)
                    else:
                        logger.warning("No public URL for full_body, skipping parsing-v1")
                except Exception as parse_exc:
                    logger.warning("parsing-v1 split failed (non-fatal): %s", parse_exc)

                logger.info(
                    "Avatar: stored %d items in %.2fs",
                    len(results), _time.perf_counter() - avatar_t0,
                )
                print(
                    f'PARSE_RESULT: avatar count={len(results)}, '
                    f'types={[r.type for r in results]}, names={[r.name for r in results]}'
                )
                return ParseResponse(
                    items=results,
                    count=len(results),
                    image_path=image_paths.get("image_path"),
                )
            else:
                logger.info("parse_avatar returned no usable layer, falling through to AI")
        except Exception as exc:
            logger.warning("Avatar SegmentCloth failed: %s, falling through to AI", exc)
    # Path B: Fallback — AI analysis when primary processing fails
    # ---------------------------------------------------------------
    try:
        ai_service = AIService()
        vision_service = AliyunVisionService()

        # Try to segment the image into individual items first
        seg_results: dict[str, bytes] = {}
        try:
            if scene_type == 'avatar':
                # Avatar: SegmentCloth full foreground
                layers = await vision_service.parse_avatar(content)
                if 'full_body' in layers:
                    seg_results = {'outfit': layers['full_body']}
                elif layers:
                    seg_results = {'outfit': next(iter(layers.values()))}
                if not seg_results:
                    seg_bytes = await vision_service.segment_commodity(content)
                    seg_results = {'outfit': seg_bytes}
            else:
                # Commodity: background removal + connected-component splitting
                split_items = await vision_service.segment_commodity_items(content)
                seg_results = split_items if split_items else {}
        except Exception as seg_exc:
            logger.warning('Fallback segmentation failed: %s', seg_exc)

        if seg_results and len(seg_results) > 0:
            # We have segmented individual items — store each and enrich with AI
            for key, seg_bytes in seg_results.items():
                try:
                    seg_paths = await image_service.process_and_store_png(
                        user_id=current_user.id,
                        image_data=seg_bytes,
                        original_filename=f"seg_{key}.png",
                    )
                    if key == 'outfit':
                        item_type = 'outfit'
                        name_zh = '穿搭照'
                    else:
                        item_type = 'unknown'
                        name_zh = f'衣物 {key.split(chr(95))[-1]}'
                    results.append(ParsedItemResult(
                        name=name_zh or f"衣物 {key.split('_')[-1]}",
                        type=item_type,
                        category=key,
                        segmented_image_path=seg_paths.get("image_path"),
                        thumbnail_url=sign_image_url(seg_paths.get("thumbnail_path"))
                        if seg_paths.get("thumbnail_path") else None,
                        confidence=0.8,
                    ))
                except Exception as e:
                    logger.warning("Failed to store fallback segment '%s': %s", key, e)

            if results:
                # Enrich each segment with AI tags
                results = await _enrich_segmented_items(results, ai_service, settings.storage_path)
        else:
            # No segmentation possible — pure AI analysis (single shared image)
            tags_list = await ai_service.analyze_image_multi(full_image_path)
            for tags in tags_list:
                results.append(ParsedItemResult(
                    name=tags.name or tags.type or "未命名单品",
                    type=tags.type or "unknown",
                    primary_color=tags.primary_color,
                    material=tags.material,
                    style=tags.style or [],
                    description=tags.description,
                    confidence=tags.confidence,
                ))

        print(f'PARSE_RESULT: count={len(results)}, types={[r.type for r in results]}, names={[r.name for r in results]}')
        for _r in results:
            _r.source_scene = scene_type
            _r.tryon_ready = (scene_type == "avatar")
        return ParseResponse(
            items=results,
            count=len(results),
            image_path=image_paths.get("image_path"),
        )
    except Exception as e:
        logger.error(f"AI parse failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI analysis failed, please try again",
        ) from None
@router.post("/from-parse", response_model=FromParseResponse)
async def create_items_from_parse(
    request: FromParseRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FromParseResponse:
    """Create clothing items from a previous AI parse result."""
    from app.services.aliyun_vision_service import AliyunVisionService

    item_service = ItemService(db)
    image_service = ImageService()

    created = 0
    failed = 0
    item_ids: list[str] = []
    errors: list[str] = []

    has_presegmented = any(
        getattr(item, "segmented_image_path", None) for item in request.items
    )
    # Path A: Pre-segmented items
    print(f"FROM_PARSE_DEBUG: has_presegmented={has_presegmented}, items_count={len(request.items)}, scene_type={request.scene_type}")
    for _idx, _item in enumerate(request.items):
        _seg = getattr(_item, "segmented_image_path", None)
        print(f"FROM_PARSE_DEBUG item[{_idx}]: name={_item.name} type={_item.type} seg_path={_seg}")
    if has_presegmented:
        for parsed in request.items:
            try:
                seg_path = getattr(parsed, "segmented_image_path", None)
                if seg_path:
                    import os
                    base, ext = os.path.splitext(seg_path)
                    item_image_paths = {
                        "image_path": seg_path,
                        "thumbnail_path": f"{base}_thumb{ext}",
                        "medium_path": f"{base}_medium{ext}",
                    }
                else:
                    item_image_paths = {
                        "image_path": "",
                        "thumbnail_path": "",
                        "medium_path": "",
                    }

                item_data = ItemCreate(
                    type=parsed.type or "unknown",
                    name=parsed.name,
                    colors=[parsed.primary_color] if parsed.primary_color else None,
                    primary_color=parsed.primary_color,
                )

                item = await item_service.create(
                    user_id=current_user.id,
                    item_data=item_data,
                    image_paths=item_image_paths,
                )

                # Save OSS public URLs
                if item_image_paths.get("public_url"):
                    item.public_url = item_image_paths.get("public_url")
                    item.public_url_medium = item_image_paths.get("public_url_medium")
                    item.public_url_thumbnail = item_image_paths.get("public_url_thumbnail")
                    await db.flush()

                # Set source scene fields - use each item's own values
                item.source_scene = getattr(parsed, 'source_scene', None) or "commodity"
                item.tryon_ready = bool(getattr(parsed, 'tryon_ready', False))

                item_ids.append(str(item.id))
                created += 1

                if item_image_paths.get("image_path"):
                    try:
                        redis = await create_pool(get_redis_settings())
                        try:
                            full_image_path = (
                                f"{settings.storage_path}/{item_image_paths['image_path']}"
                            )
                            await redis.enqueue_job(
                                "tag_item_image",
                                str(item.id),
                                full_image_path,
                                _queue_name="arq:tagging",
                            )
                        finally:
                            await redis.aclose()
                    except Exception as e:
                        logger.warning(f"Failed to queue tagging for parsed item {item.id}: {e}")

            except Exception as e:
                logger.error(f"Failed to create pre-segmented item: {e}")
                errors.append(str(e))
                failed += 1

        return FromParseResponse(created=created, failed=failed, item_ids=item_ids, errors=errors)

    # Path B: Non-segmented
    vision_service = AliyunVisionService()
    final_image_paths: dict[str, str] = {}

    if request.image_path:
        full_source_path = Path(settings.storage_path) / request.image_path
        if full_source_path.exists():
            try:
                source_bytes = full_source_path.read_bytes()

                if request.scene_type == "avatar":
                    layers = await vision_service.parse_avatar(source_bytes)
                    from app.services.aliyun_vision_service import _pick_primary_layer
                    seg_bytes = _pick_primary_layer(layers)
                else:
                    seg_bytes = await vision_service.segment_commodity(source_bytes)

                final_image_paths = await image_service.process_and_store_png(
                    user_id=current_user.id,
                    image_data=seg_bytes,
                    original_filename="segmented.png",
                )
                logger.info(
                    "Background removed for from-parse, stored PNG: %s",
                    final_image_paths.get("image_path"),
                )
            except Exception as seg_exc:
                logger.warning(
                    "Segmentation failed, using original image: %s", seg_exc,
                )
                base = request.image_path.rsplit(".", 1)[0]
                ext = request.image_path.rsplit(".", 1)[-1]
                final_image_paths = {
                    "image_path": request.image_path,
                    "thumbnail_path": f"{base}_thumb.{ext}",
                    "medium_path": f"{base}_medium.{ext}",
                }
        else:
            logger.warning("Source image not found at %s", full_source_path)

    for parsed in request.items:
        try:
            item_data = ItemCreate(
                type=parsed.type or "unknown",
                name=parsed.name,
                colors=[parsed.primary_color] if parsed.primary_color else None,
                primary_color=parsed.primary_color,
            )

            if final_image_paths:
                image_paths = final_image_paths
            else:
                image_paths = {
                    "image_path": "",
                    "thumbnail_path": "",
                    "medium_path": "",
                }

            item = await item_service.create(
                user_id=current_user.id,
                item_data=item_data,
                image_paths=image_paths,
            )

            # Save OSS public URLs
            if image_paths.get("public_url"):
                item.public_url = image_paths.get("public_url")
                item.public_url_medium = image_paths.get("public_url_medium")
                item.public_url_thumbnail = image_paths.get("public_url_thumbnail")
                await db.flush()

            # Set source scene fields based on request
            if request.scene_type == "avatar":
                item.source_scene = "avatar"
                item.tryon_ready = True
            else:
                item.source_scene = "commodity"
                item.tryon_ready = False

            item_ids.append(str(item.id))
            created += 1

            if final_image_paths.get("image_path"):
                try:
                    redis = await create_pool(get_redis_settings())
                    try:
                        full_image_path = (
                            f"{settings.storage_path}/{final_image_paths['image_path']}"
                        )
                        await redis.enqueue_job(
                            "tag_item_image",
                            str(item.id),
                            full_image_path,
                            _queue_name="arq:tagging",
                        )
                    finally:
                        await redis.aclose()
                except Exception as e:
                    logger.warning(f"Failed to queue tagging for parsed item {item.id}: {e}")

        except Exception as e:
            logger.error(f"Failed to create item from parse: {e}")
            errors.append(str(e))
            failed += 1

    return FromParseResponse(created=created, failed=failed, item_ids=item_ids, errors=errors)










