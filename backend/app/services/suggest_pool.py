"""Suggest-feed pool backed by the accumulated try-on library.

Pool membership = AI-generated outfits (``source=on_demand``) that already have a
try-on image, at least one garment, and were created since
``suggest_library_since``. Nothing is dropped for having been shown before:
repeats are only deprioritized (least-recently-shown first), so the feed keeps
serving instantly and for free instead of paying for a fresh generation.

Bookkeeping lives in Redis (no schema migration — the project's Alembic graph is
broken):
  * ``suggest:seen:{user}``   — outfit_id -> last shown ts (rotation order)
  * ``suggest:person:{user}`` — outfit_id -> content fingerprint of the person
    photo the image was generated with, so images made for an older body photo
    stop being served once the user switches their try-on person.
"""

import asyncio
import hashlib
import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.body_profile import BodyProfile
from app.models.outfit import FamilyOutfitRating, Outfit, OutfitItem, OutfitSource
from app.utils.redis_lock import get_redis

logger = logging.getLogger(__name__)

_SEEN_KEY = "suggest:seen:{user_id}"
_PERSON_KEY = "suggest:person:{user_id}"
_PERSON_CACHE_KEY = "suggest:person-cur:{user_id}"
_RUNNING_KEY = "suggest:replenish:{user_id}"
_BUDGET_KEY = "suggest:gen:budget:{user_id}:{day}"
_CANDIDATE_LIMIT = 400
_PERSON_CACHE_TTL = 30 * 24 * 3600


# ===== Library membership =====


async def resolve_person_ref(db: AsyncSession, user_id: UUID | str) -> str:
    """The try-on person the user currently prefers (body photo, else the demo model)."""
    from app.services.virtual_tryon_service import DEFAULT_PERSON_URL

    uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    result = await db.execute(select(BodyProfile).where(BodyProfile.user_id == uid))
    profile = result.scalar_one_or_none()
    if profile and profile.full_body_photo_url:
        return profile.full_body_photo_url
    return DEFAULT_PERSON_URL


def image_fingerprint(ref: str) -> str | None:
    """Content hash of a person photo — unchanged when the same file is re-uploaded."""
    from app.services.virtual_tryon_service import _load_image_bytes

    raw = _load_image_bytes(ref)
    if not raw:
        return None
    return hashlib.sha256(raw).hexdigest()[:12]


async def current_person_fingerprint(db: AsyncSession, user_id: UUID | str) -> str | None:
    """Fingerprint of the current person photo (cached by ref in Redis)."""
    ref = await resolve_person_ref(db, user_id)
    cache_key = _PERSON_CACHE_KEY.format(user_id=user_id)
    redis = None
    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached and cached.startswith(f"{ref}|"):
            return cached.split("|", 1)[1]
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to read person fingerprint cache: %s", e)

    fingerprint = await asyncio.to_thread(image_fingerprint, ref)
    if fingerprint:
        try:
            if redis is None:
                redis = await get_redis()
            await redis.set(cache_key, f"{ref}|{fingerprint}", ex=_PERSON_CACHE_TTL)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to cache person fingerprint: %s", e)
    return fingerprint


async def person_stamps(user_id: UUID | str) -> dict[str, str]:
    try:
        redis = await get_redis()
        raw = await redis.hgetall(_PERSON_KEY.format(user_id=user_id))
        return {k: (v or "") for k, v in raw.items()}
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to read person stamps: %s", e)
        return {}


async def stamp_person(user_id: UUID | str, outfit_ids: list[str], fingerprint: str | None) -> None:
    """Record which person photo an image was generated with."""
    if not outfit_ids or not fingerprint:
        return
    try:
        redis = await get_redis()
        await redis.hset(
            _PERSON_KEY.format(user_id=user_id),
            mapping=dict.fromkeys(outfit_ids, fingerprint),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to stamp person fingerprint: %s", e)


def _library_since() -> datetime:
    raw = get_settings().suggest_library_since
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=UTC)
    except ValueError:
        logger.warning("Invalid suggest_library_since %r; using 2026-10-01", raw)
        return datetime(2026, 10, 1, tzinfo=UTC)


def _library_conditions(user_id: UUID | str, occasion: str | None = None) -> list:
    uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    conditions = [
        Outfit.user_id == uid,
        Outfit.source == OutfitSource.on_demand,
        Outfit.model_image_url.isnot(None),
        Outfit.items.any(),
        Outfit.created_at >= _library_since(),
    ]
    if occasion:
        conditions.append(Outfit.occasion == occasion)
    return conditions


def _stamp_matches(stamp: str | None, fingerprint: str | None) -> bool:
    """Unstamped legacy rows stay visible; stamped rows must match the current person."""
    if stamp is None or fingerprint is None:
        return True
    return stamp == fingerprint


async def _eligible_ids(
    db: AsyncSession, user_id: UUID | str, occasion: str | None, fingerprint: str | None
) -> list[UUID]:
    """Library outfit ids visible to the current person, newest first."""
    query = (
        select(Outfit.id)
        .where(*_library_conditions(user_id, occasion))
        .order_by(Outfit.created_at.desc())
        .limit(_CANDIDATE_LIMIT)
    )
    ids = list((await db.execute(query)).scalars().all())
    if not ids:
        return []
    stamps = await person_stamps(user_id)
    return [oid for oid in ids if _stamp_matches(stamps.get(str(oid)), fingerprint)]


async def ready_count(
    db: AsyncSession, user_id: UUID | str, occasion: str | None = None, fingerprint: str | None = None
) -> int:
    if fingerprint is None:
        fingerprint = await current_person_fingerprint(db, user_id)
    return len(await _eligible_ids(db, user_id, occasion, fingerprint))


# ===== Serving =====


async def last_shown_map(user_id: UUID | str) -> dict[str, int]:
    try:
        redis = await get_redis()
        raw = await redis.hgetall(_SEEN_KEY.format(user_id=user_id))
        return {k: int(v or 0) for k, v in raw.items()}
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to read shown ledger: %s", e)
        return {}


async def mark_shown(user_id: UUID | str, outfit_ids: list[str]) -> None:
    if not outfit_ids:
        return
    try:
        redis = await get_redis()
        now = int(datetime.now(UTC).timestamp())
        await redis.hset(_SEEN_KEY.format(user_id=user_id), mapping=dict.fromkeys(outfit_ids, now))
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to update shown ledger: %s", e)


async def forget_outfit(user_id: UUID | str, outfit_id: str) -> None:
    """Drop one outfit's ledger rows (rotation time + person stamp) after it is deleted."""
    try:
        redis = await get_redis()
        await redis.hdel(_SEEN_KEY.format(user_id=user_id), outfit_id)
        await redis.hdel(_PERSON_KEY.format(user_id=user_id), outfit_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to drop ledger rows for %s: %s", outfit_id, e)


async def take_from_pool(
    db: AsyncSession, user_id: UUID | str, limit: int, occasion: str | None = None
) -> list[Outfit]:
    """Serve up to ``limit`` outfits, least-recently-shown first, and note the time."""
    fingerprint = await current_person_fingerprint(db, user_id)
    ids = await _eligible_ids(db, user_id, occasion, fingerprint)
    if not ids:
        return []

    shown = await last_shown_map(user_id)
    ids.sort(key=lambda oid: shown.get(str(oid), 0))
    picked = ids[:limit]

    query = (
        select(Outfit)
        .where(Outfit.id.in_(picked))
        .options(
            selectinload(Outfit.items).selectinload(OutfitItem.item),
            selectinload(Outfit.feedback),
            selectinload(Outfit.family_ratings).selectinload(FamilyOutfitRating.user),
        )
    )
    outfits = list((await db.execute(query)).scalars().all())
    await mark_shown(user_id, [str(o.id) for o in outfits])
    return outfits


# ===== Replenish flag & daily budget =====


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
