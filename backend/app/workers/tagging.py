import logging
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from app.models.item import ClothingItem, ItemStatus
from app.services.ai_service import AIService, ClothingTags
from app.services.inapp_notice_service import push_notice
from app.workers.db import get_db_session

logger = logging.getLogger(__name__)


def tags_to_item_fields(tags: ClothingTags, raw_response: str | None = None) -> dict[str, Any]:
    """Convert ClothingTags to item database fields."""
    # Build the tags JSONB object for frontend display
    tags_jsonb = {
        "colors": tags.colors or [],
        "pattern": tags.pattern,
        "material": tags.material,
        "style": tags.style or [],
        "season": tags.season or [],
        "formality": tags.formality,
        "fit": tags.fit,
        "occasion": tags.occasion or [],
        "brand": tags.brand,
        "condition": tags.condition,
        "features": tags.features or [],
    }
    if tags.logprobs_confidence is not None:
        tags_jsonb["logprobs_confidence"] = tags.logprobs_confidence

    fields = {
        "type": tags.type,
        "name": tags.name,
        "subtype": tags.subtype,
        "primary_color": tags.primary_color,
        "colors": tags.colors,
        "pattern": tags.pattern,
        "material": tags.material,
        "style": tags.style,
        "formality": tags.formality,
        "season": tags.season,
        "description": tags.description,
        "brand": tags.brand,
        "tags": tags_jsonb,  # Populate the tags JSONB field for frontend
        "ai_processed": True,
        "ai_confidence": tags.confidence,
        "ai_description": tags.description,  # Human-readable description
        "status": ItemStatus.ready,
    }
    if raw_response:
        fields["ai_raw_response"] = {"raw_text": raw_response}
    return fields


async def update_item_status_to_error(ctx: dict, item_id: str, error_msg: str) -> None:
    """Update item status to error in database."""
    try:
        db = get_db_session(ctx)
        try:
            result = await db.execute(select(ClothingItem).where(ClothingItem.id == UUID(item_id)))
            item = result.scalar_one_or_none()
            if item:
                item.status = ItemStatus.error
                item.ai_raw_response = {"error": error_msg}
                await db.commit()
        finally:
            await db.close()
    except Exception as e:
        logger.error(f"Failed to update item {item_id} status to error: {e}")


async def tag_item_image(ctx: dict, item_id: str, image_path: str) -> dict[str, Any]:
    """
    Analyze an item's image and update it with AI-generated tags.

    Args:
        ctx: arq context
        item_id: UUID of the item to tag
        image_path: Path to the image file

    Returns:
        Dict with status and tags
    """
    logger.info(f"Starting AI tagging for item {item_id}")

    try:
        # Verify image exists
        path = Path(image_path)
        if not path.exists():
            error_msg = f"Image not found: {image_path}"
            logger.error(error_msg)
            await update_item_status_to_error(ctx, item_id, error_msg)
            return {"status": "error", "error": "Image not found"}

        # Get user's AI endpoints from preferences
        ai_endpoints = None
        db = get_db_session(ctx)
        try:
            # Get the item to find user_id
            result = await db.execute(select(ClothingItem).where(ClothingItem.id == UUID(item_id)))
            item = result.scalar_one_or_none()
            if item:
                # Get user's preferences for AI endpoints
                from app.models.preference import UserPreference

                pref_result = await db.execute(
                    select(UserPreference).where(UserPreference.user_id == item.user_id)
                )
                prefs = pref_result.scalar_one_or_none()
                if prefs and prefs.ai_endpoints:
                    ai_endpoints = prefs.ai_endpoints
                    logger.info(
                        f"Using {len(ai_endpoints)} custom AI endpoints for user {item.user_id}"
                    )
        finally:
            await db.close()

        # Analyze with AI (uses custom endpoints if available)
        # Now uses multi-item detection to find all clothing items in the image
        ai_service = AIService(endpoints=ai_endpoints)
        all_tags = await ai_service.analyze_image_multi(path)

        logger.info(
            f"AI analysis complete for item {item_id}: found {len(all_tags)} items "
            f"(types: {[t.type for t in all_tags]})"
        )

        # Get the first item's tags for the original item
        tags = all_tags[0]

        # Post-process: if description/name is in English, force re-generate in Chinese
        import re as _re
        def _is_english_text(text: str | None) -> bool:
            """Check if text contains mostly English characters."""
            if not text:
                return False
            # If more than 60% ASCII letters, likely English
            ascii_count = sum(1 for c in text if 'a' <= c.lower() <= 'z')
            return ascii_count / max(len(text), 1) > 0.4

        async def _ensure_chinese_description(item_tags: ClothingTags) -> None:
            """If description or name is English, regenerate in Chinese."""
            if _is_english_text(item_tags.description) or _is_english_text(item_tags.name):
                logger.info(f"Detected English description for {item_tags.type}, regenerating in Chinese")
                try:
                    desc_service = AIService(endpoints=ai_endpoints)
                    item_info = f"{item_tags.name or item_tags.type}, {item_tags.primary_color or ''}, {item_tags.material or ''}"
                    cn_prompt = f"请用中文写一段30-60字的衣物介绍描述。衣物信息：{item_info}。要求：用自然流畅的中文，提及款式、颜色、材质、适合场合。不要用英文，必须中文输出。不要用\"这是一件\"开头。"
                    cn_desc = await desc_service.generate_text(cn_prompt)
                    if cn_desc and not _is_english_text(cn_desc):
                        # Clean up quotes
                        cn_desc = cn_desc.strip().strip('"').strip("'")
                        item_tags.description = cn_desc
                        item_tags.name = cn_desc[:15] if _is_english_text(item_tags.name) else item_tags.name
                        logger.info(f"Chinese description generated: {cn_desc[:50]}")
                except Exception as e:
                    logger.warning(f"Failed to generate Chinese description: {e}")

        # Ensure Chinese descriptions for all items
        for tag_item in all_tags:
            await _ensure_chinese_description(tag_item)
        tags = all_tags[0]  # Re-assign after potential modification

        # Update item in database
        db = get_db_session(ctx)
        try:
            result = await db.execute(select(ClothingItem).where(ClothingItem.id == UUID(item_id)))
            item = result.scalar_one_or_none()

            if item is None:
                logger.error(f"Item not found: {item_id}")
                return {"status": "error", "error": "Item not found"}

            # Get user_id for creating additional items
            user_id = item.user_id

            # Update item fields - only update if user hasn't already set a value
            # Always update: ai_processed, ai_confidence, status, ai_raw_response
            # Conditionally update: type, subtype, primary_color, colors, pattern, material, style, formality, season
            ai_fields = tags_to_item_fields(tags, tags.raw_response)

            for field, value in ai_fields.items():
                # Always update AI metadata fields (including tags JSONB and description)
                if field in (
                    "ai_processed",
                    "ai_confidence",
                    "status",
                    "ai_raw_response",
                    "tags",
                    "ai_description",
                ):
                    setattr(item, field, value)
                # Always update name and description from AI (these are AI-generated)
                elif field in ("name", "description"):
                    if value:
                        setattr(item, field, value)
                # Only update content fields if user hasn't set them (or they're default/unknown)
                elif field == "type":
                    if not item.type or item.type == "unknown":
                        setattr(item, field, value)
                elif field == "subtype":
                    if not item.subtype:
                        setattr(item, field, value)
                elif field == "primary_color":
                    if not item.primary_color or item.primary_color == "unknown":
                        setattr(item, field, value)
                else:
                    # For other fields (colors, pattern, material, style, etc.), only set if not already set
                    current_value = getattr(item, field, None)
                    if (
                        current_value is None
                        or current_value == []
                        or current_value == ""
                        or current_value == {}
                    ):
                        setattr(item, field, value)

            await db.commit()
            logger.info(f"Updated item {item_id} with AI tags (status=ready)")

            # Create additional items for extra clothing items found in the image
            additional_item_ids = []
            if len(all_tags) > 1:
                for extra_tags in all_tags[1:]:
                    try:
                        extra_fields = tags_to_item_fields(extra_tags, extra_tags.raw_response)
                        new_item = ClothingItem(
                            user_id=user_id,
                            image_url=item.image_url,  # Same image reference
                            thumbnail_url=item.thumbnail_url,
                            **{k: v for k, v in extra_fields.items() if hasattr(ClothingItem, k)},
                        )
                        db.add(new_item)
                        await db.flush()  # Get the new item's ID
                        additional_item_ids.append(str(new_item.id))
                        logger.info(
                            f"Created additional item {new_item.id}: "
                            f"type={extra_tags.type}, color={extra_tags.primary_color}"
                        )
                    except Exception as e:
                        logger.warning(f"Failed to create additional item: {e}")

                if additional_item_ids:
                    await db.commit()
                    logger.info(
                        f"Created {len(additional_item_ids)} additional items from multi-item detection"
                    )

            # 这批衣物全部识别完（没有别的还在识别中的）→ 推一条应用内通知，
            # 覆盖"上传后离开页面"的场景
            remaining = (
                await db.execute(
                    select(func.count())
                    .select_from(ClothingItem)
                    .where(
                        ClothingItem.user_id == user_id,
                        ClothingItem.status == ItemStatus.processing,
                    )
                )
            ).scalar()
            if not remaining:
                await push_notice(
                    user_id,
                    kind="items_ready",
                    title="衣物识别完成，去衣橱看看吧",
                    target="wardrobe",
                )

            return {
                "status": "success",
                "item_id": item_id,
                "tags": tags.model_dump(exclude={"raw_response"}),
                "additional_items": additional_item_ids,
                "total_items_found": len(all_tags),
            }

        finally:
            await db.close()

    except Exception as e:
        error_msg = str(e)
        logger.exception(f"Error tagging item {item_id}: {error_msg}")
        await update_item_status_to_error(ctx, item_id, error_msg)
        return {"status": "error", "error": error_msg}


