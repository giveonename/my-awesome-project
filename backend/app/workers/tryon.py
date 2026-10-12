"""arq jobs for try-on generation.

Batch try-on generation used to run as in-process asyncio tasks in the backend
(and was silently competing with interactive try-on calls). Moving it to the
worker gives us: survival across backend restarts, natural serialization
(qwen-image-3.0 rejects bursts with Throttling.RateQuota, ~80-100s per image)
and a place to run pool replenishment.
"""

import asyncio
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.body_profile import BodyProfile
from app.models.outfit import Outfit, OutfitItem
from app.models.user import User
from app.services.inapp_notice_service import push_notice
from app.services.suggest_pool import clear_replenishing, ready_count
from app.services.virtual_tryon_service import (
    DEFAULT_PERSON_URL,
    resolve_tryon_inputs,
    virtual_tryon,
)
from app.workers.db import get_db_session

logger = logging.getLogger(__name__)

# One generation at a time inside the worker process.
_GENERATION_SEMAPHORE = asyncio.Semaphore(1)


def _items_payload(outfit: Outfit) -> list[dict]:
    return [
        {
            "ref": oi.item.image_path,
            "type": oi.item.type or "",
            "name": oi.item.name or "",
            "primary_color": oi.item.primary_color or "",
        }
        for oi in outfit.items
        if oi.item and oi.item.image_path
    ]


async def _person_ref(db, user_id) -> str:
    result = await db.execute(select(BodyProfile).where(BodyProfile.user_id == user_id))
    profile = result.scalar_one_or_none()
    if profile and profile.full_body_photo_url:
        return profile.full_body_photo_url
    return DEFAULT_PERSON_URL


async def generate_outfit_tryon(ctx: dict, outfit_id: str, user_id: str) -> dict:
    """Generate a single outfit's try-on image (serialized)."""
    db = get_db_session(ctx)
    try:
        result = await db.execute(
            select(Outfit)
            .where(Outfit.id == UUID(outfit_id))
            .options(selectinload(Outfit.items).selectinload(OutfitItem.item))
        )
        outfit = result.scalar_one_or_none()
        if not outfit:
            return {"status": "error", "error": "outfit not found"}
        if outfit.model_image_url:
            return {"status": "skipped", "reason": "already has image"}

        refs, descs, is_outfit = resolve_tryon_inputs(_items_payload(outfit))
        if not refs:
            return {"status": "error", "error": "no usable garment refs"}
        person_ref = await _person_ref(db, outfit.user_id)

        async with _GENERATION_SEMAPHORE:
            tryon = await virtual_tryon(
                person_ref=person_ref,
                garment_refs=refs,
                descs=descs,
                is_outfit=is_outfit,
                user_id=outfit.user_id,
            )
        if not tryon.success:
            logger.error("Try-on failed for outfit %s: %s", outfit_id, tryon.error)
            return {"status": "error", "error": tryon.error}

        outfit.model_image_url = tryon.image_url
        await db.commit()
        logger.info("Try-on image generated for outfit %s", outfit_id)
        return {"status": "success"}
    except Exception as e:  # noqa: BLE001
        logger.error("generate_outfit_tryon error for %s: %s", outfit_id, e, exc_info=True)
        return {"status": "error", "error": str(e)[:200]}
    finally:
        await db.close()


async def replenish_suggest_pool(ctx: dict, user_id: str, occasion: str | None = None) -> dict:
    """Top the suggest pool up to the configured target.

    Creates new AI outfits and generates their try-on images sequentially,
    then drops an in-app notice so the user knows fresh looks are ready.
    """
    from app.services.recommendation_service import RecommendationService

    settings = get_settings()
    uid = UUID(user_id)
    db = get_db_session(ctx)
    try:
        user = (
            await db.execute(
                select(User).where(User.id == uid).options(selectinload(User.preferences))
            )
        ).scalar_one_or_none()
        if not user:
            return {"status": "error", "error": "user not found"}

        ready = await ready_count(db, uid, occasion)
        need = settings.suggest_pool_target - ready
        if need <= 0:
            logger.info("Suggest pool already at target (%d/%d)", ready, settings.suggest_pool_target)
            return {"status": "ok", "ready": ready, "need": 0}

        service = RecommendationService(db)
        if not occasion:
            occasion = (
                user.preferences.default_occasion
                if user.preferences and user.preferences.default_occasion
                else "casual"
            )

        prepared: list[tuple[Outfit, list[str], list[dict], bool]] = []
        attempts = 0
        while len(prepared) < need and attempts < need * 3:
            attempts += 1
            try:
                outfit = await service.generate_recommendation(
                    user=user,
                    occasion=occasion,
                    source_scene="commodity",
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("Replenish attempt %d failed: %s", attempts, e)
                continue
            # Snapshot refs BEFORE commit (avoid lazy-load after commit)
            refs, descs, is_outfit = resolve_tryon_inputs(_items_payload(outfit))
            if refs:
                prepared.append((outfit, refs, descs, is_outfit))

        created = len(prepared)
        if not created:
            logger.warning("Replenish produced no usable outfits for user %s", uid)
            return {"status": "ok", "created": 0, "generated": 0}

        await db.commit()

        person_ref = await _person_ref(db, uid)
        generated = 0
        for outfit, refs, descs, is_outfit in prepared:
            try:
                async with _GENERATION_SEMAPHORE:
                    tryon = await virtual_tryon(
                        person_ref=person_ref,
                        garment_refs=refs,
                        descs=descs,
                        is_outfit=is_outfit,
                        user_id=uid,
                    )
                if tryon.success:
                    outfit.model_image_url = tryon.image_url
                    await db.commit()
                    generated += 1
                else:
                    logger.warning("Pool try-on failed for outfit %s: %s", outfit.id, tryon.error)
            except Exception as e:  # noqa: BLE001
                logger.error("Pool try-on error for outfit %s: %s", outfit.id, e)

        if generated > 0:
            await push_notice(
                uid,
                kind="suggest_ready",
                title=f"新的 {generated} 套搭配已备好，快去搭配页看看吧",
                target="suggest",
            )
        logger.info("Suggest pool replenished for %s: created=%d generated=%d", uid, created, generated)
        return {"status": "ok", "created": created, "generated": generated}
    except Exception as e:  # noqa: BLE001
        logger.error("replenish_suggest_pool error for %s: %s", user_id, e, exc_info=True)
        return {"status": "error", "error": str(e)[:200]}
    finally:
        await clear_replenishing(uid)
        await db.close()
