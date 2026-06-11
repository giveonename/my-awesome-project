"""Batch parse API endpoints for multi-photo upload."""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.batch import BatchParseJob
from app.models.item import ClothingItem, ItemStatus
from app.models.user import User
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Batch Parse"])


class BatchParseResponse(BaseModel):
    batch_id: str
    total_count: int


class BatchItemPreview(BaseModel):
    id: str
    name: str
    type: str
    primary_color: str
    thumbnail_path: str | None
    status: str
    scene_type: str


class BatchStatusResponse(BaseModel):
    batch_id: str
    status: str
    total: int
    completed: int
    failed: int
    items: list[BatchItemPreview]


@router.post("/items/batch-parse", response_model=BatchParseResponse)
async def batch_parse(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    files: list[UploadFile] = File(..., description="Photos to parse (max 9)"),
    scene_types: str = Form("commodity", description="Scene type for all files"),
    batch_id: str = Form("", description="Existing batch ID to append to"),
):
    """Accept multiple photos for batch AI parsing.

    Creates a BatchParseJob and enqueues individual parse jobs for each photo.
    Returns immediately with the batch ID for polling.
    If batch_id is provided, appends to existing batch.
    """
    from app.services.image_service import ImageService
    from arq import create_pool
    from app.workers.settings import get_redis_settings

    if len(files) > 9:
        raise HTTPException(status_code=400, detail="最多上传 9 张照片")
    if len(files) == 0:
        raise HTTPException(status_code=400, detail="请至少上传 1 张照片")

    scene_type = scene_types.strip() or "commodity"

    # Find or create batch job
    batch = None
    if batch_id:
        try:
            result = await db.execute(
                select(BatchParseJob).where(
                    BatchParseJob.id == UUID(batch_id),
                    BatchParseJob.user_id == current_user.id,
                )
            )
            batch = result.scalar_one_or_none()
        except (ValueError, Exception):
            pass

    if not batch:
        batch = BatchParseJob(
            user_id=current_user.id,
            total_count=0,
            status="processing",
        )
        db.add(batch)
        await db.flush()

    image_svc = ImageService()
    redis = await create_pool(get_redis_settings())
    created_items = []

    for i, file in enumerate(files):
        try:
            # Read file content
            content = await file.read()
            if not content:
                continue

            # Store image
            image_path, thumb_path, medium_path, public_url, _ = await image_svc.process_and_store(
                content, str(current_user.id), file.filename
            )

            # Create item in processing state
            item = ClothingItem(
                user_id=current_user.id,
                image_path=image_path,
                thumbnail_path=thumb_path,
                medium_path=medium_path,
                public_url=public_url,
                source_scene=scene_type,
                status=ItemStatus.processing,
                name="识别中...",
                type="unknown",
            )
            db.add(item)
            await db.flush()

            # Enqueue parse job
            try:
                await redis.enqueue_job(
                    "batch_parse_item",
                    str(batch.id),
                    str(item.id),
                    image_path,
                    scene_type,
                    _queue_name="arq:tagging",
                )
            except Exception as e:
                logger.error("Failed to enqueue batch parse job: %s", e)
                item.status = ItemStatus.error
                batch.failed_count += 1

            created_items.append(item)

        except Exception as e:
            logger.error("Failed to process file %d: %s", i, e)
            batch.failed_count += 1

    # Update total count
    batch.total_count += len(created_items)
    await db.commit()

    return BatchParseResponse(
        batch_id=str(batch.id),
        total_count=len(created_items),
    )


@router.get("/items/batch-status/{batch_id}", response_model=BatchStatusResponse)
async def batch_status(
    batch_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Poll batch parse job status.

    Returns current progress and previews of completed items.
    """
    from app.utils.signed_urls import sign_image_url

    try:
        bid = UUID(batch_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid batch ID")

    batch = await db.execute(
        select(BatchParseJob).where(
            BatchParseJob.id == bid,
            BatchParseJob.user_id == current_user.id,
        )
    )
    batch = batch.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch job not found")

    # Count actual completed/failed items
    items_result = await db.execute(
        select(ClothingItem).where(
            ClothingItem.user_id == current_user.id,
            ClothingItem.source_scene.in_(["commodity", "avatar"]),
        ).order_by(ClothingItem.created_at.desc()).limit(batch.total_count * 2)
    )
    recent_items = items_result.scalars().all()

    # Filter to items created around the batch time
    batch_items = []
    for item in recent_items:
        if item.created_at and batch.created_at:
            time_diff = abs((item.created_at - batch.created_at).total_seconds())
            if time_diff < 3600:  # Within 1 hour of batch creation
                batch_items.append(item)

    completed = [i for i in batch_items if i.status == ItemStatus.ready]
    failed = [i for i in batch_items if i.status == ItemStatus.error]
    processing = [i for i in batch_items if i.status == ItemStatus.processing]

    # Update batch counts
    batch.completed_count = len(completed)
    batch.failed_count = len(failed)
    if not processing and completed:
        batch.status = "completed" if not failed else "partial"
    await db.commit()

    # Build preview items
    items_preview = []
    for item in completed:
        thumb = sign_image_url(item.thumbnail_path) if item.thumbnail_path else None
        items_preview.append(BatchItemPreview(
            id=str(item.id),
            name=item.name or item.type or "衣物",
            type=item.type or "unknown",
            primary_color=item.primary_color or "",
            thumbnail_path=thumb,
            status=item.status.value if hasattr(item.status, 'value') else str(item.status),
            scene_type=item.source_scene or "commodity",
        ))

    return BatchStatusResponse(
        batch_id=str(batch.id),
        status=batch.status,
        total=batch.total_count,
        completed=batch.completed_count,
        failed=batch.failed_count,
        items=items_preview,
    )
