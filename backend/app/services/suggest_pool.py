"""Suggest-feed pool: ready-to-view AI outfits with try-on images.

Pool membership = AI-generated outfits (source=on_demand) that already have a
try-on image, were created within the lookback window, and have not yet been
served to the user. "Served" state lives in Redis so no schema migration is
needed (the project's Alembic graph is broken and we avoid new revisions).
"""

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.outfit import FamilyOutfitRating, Outfit, OutfitItem, OutfitSource
from app.utils.redis_lock import get_redis

logger = logging.getLogger(__name__)

LOOKBACK_HOURS = 72
_SERVED_KEY = "suggest:served:{user_id}"
_RUNNING_KEY = "suggest:replenish:{user_id}"
_BUDGET_KEY = "suggest:gen:budget:{user_id}:{day}"


async def served_ids(user_id: UUID | str) -> set[str]:
    try:
        redis = await get_redis()
        return set(await redis.smembers(_SERVED_KEY.format(user_id=user_id)))
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to read served set: %s", e)
        return set()


async def mark_served(user_id: UUID | str, outfit_ids: list[str]) -> None:
    try:
        if not outfit_ids:
            return
        redis = await get_redis()
        key = _SERVED_KEY.format(user_id=user_id)
        await redis.sadd(key, *outfit_ids)
        await redis.expire(key, LOOKBACK_HOURS * 3600 * 2)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to mark served: %s", e)


def _pool_conditions(user_id: UUID | str, served: set[str], occasion: str | None = None) -> list:
    conditions = [
        Outfit.user_id == (user_id if isinstance(user_id, UUID) else UUID(str(user_id))),
        Outfit.source == OutfitSource.on_demand,
        Outfit.model_image_url.isnot(None),
        Outfit.created_at >= datetime.now(UTC) - timedelta(hours=LOOKBACK_HOURS),
    ]
    if occasion:
        conditions.append(Outfit.occasion == occasion)
    valid_ids = []
    for raw in served:
        try:
            valid_ids.append(UUID(raw))
        except (ValueError, TypeError):
            continue
    if valid_ids:
        conditions.append(Outfit.id.notin_(valid_ids))
    return conditions


async def ready_count(db: AsyncSession, user_id: UUID | str, occasion: str | None = None) -> int:
    served = await served_ids(user_id)
    query = select(Outfit.id).where(*_pool_conditions(user_id, served, occasion)).limit(50)
    rows = (await db.execute(query)).scalars().all()
    return len(rows)


async def take_from_pool(
    db: AsyncSession, user_id: UUID | str, limit: int, occasion: str | None = None
) -> list[Outfit]:
    """Fetch up to ``limit`` outfits from the pool and mark them served."""
    served = await served_ids(user_id)
    query = (
        select(Outfit)
        .where(*_pool_conditions(user_id, served, occasion))
        .options(
            selectinload(Outfit.items).selectinload(OutfitItem.item),
            selectinload(Outfit.feedback),
            selectinload(Outfit.family_ratings).selectinload(FamilyOutfitRating.user),
        )
        .order_by(Outfit.created_at.desc())
        .limit(limit)
    )
    outfits = list((await db.execute(query)).scalars().all())
    if outfits:
        await mark_served(user_id, [str(o.id) for o in outfits])
    return outfits


async def is_replenishing(user_id: UUID | str) -> bool:
    try:
        redis = await get_redis()
        return bool(await redis.exists(_RUNNING_KEY.format(user_id=user_id)))
    except Exception:  # noqa: BLE001
        return False


async def mark_replenishing(user_id: UUID | str, ttl_seconds: int = 2700) -> bool:
    """Set the running flag; returns False when a replenish is already running."""
    try:
        redis = await get_redis()
        result = await redis.set(
            _RUNNING_KEY.format(user_id=user_id), "1", ex=ttl_seconds, nx=True
        )
        return bool(result)
    except Exception:  # noqa: BLE001
        return False


async def clear_replenishing(user_id: UUID | str) -> None:
    try:
        redis = await get_redis()
        await redis.delete(_RUNNING_KEY.format(user_id=user_id))
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to clear replenish flag: %s", e)


def _budget_key(user_id: UUID | str) -> str:
    day = datetime.now(UTC).strftime("%Y%m%d")
    return _BUDGET_KEY.format(user_id=user_id, day=day)


async def budget_used_today(user_id: UUID | str) -> int:
    try:
        redis = await get_redis()
        value = await redis.get(_budget_key(user_id))
        return int(value or 0)
    except Exception:  # noqa: BLE001
        return 0


async def consume_budget(user_id: UUID | str) -> None:
    try:
        redis = await get_redis()
        key = _budget_key(user_id)
        await redis.incr(key)
        await redis.expire(key, 48 * 3600)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to consume suggest budget: %s", e)
