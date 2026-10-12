"""In-app task notices (Redis-backed).

Completion notices for background tasks (e.g. "try-on images are ready").
Deliberately NOT stored in the Notification table: that table feeds the
outbound delivery pipeline (ntfy/email) whose retry cron would try to
"deliver" these. Redis keeps it simple and needs no schema migration.
"""

import json
import logging
import time
import uuid

from app.utils.redis_lock import get_redis

logger = logging.getLogger(__name__)

_KEY = "inapp:notice:{user_id}"
_TTL = 7 * 24 * 3600
_MAX = 20


async def push_notice(user_id, kind: str, title: str, target: str = "") -> None:
    """Append an unread notice for the user (newest first)."""
    try:
        redis = await get_redis()
        notice = {
            "id": uuid.uuid4().hex[:12],
            "kind": kind,
            "title": title,
            "target": target,
            "ts": int(time.time()),
        }
        key = _KEY.format(user_id=user_id)
        await redis.lpush(key, json.dumps(notice, ensure_ascii=False))
        await redis.ltrim(key, 0, _MAX - 1)
        await redis.expire(key, _TTL)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to push in-app notice: %s", e)


async def list_notices(user_id) -> list[dict]:
    try:
        redis = await get_redis()
        raw = await redis.lrange(_KEY.format(user_id=user_id), 0, _MAX - 1)
        return [json.loads(item) for item in raw]
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to list in-app notices: %s", e)
        return []


async def mark_read(user_id, notice_id: str | None = None) -> None:
    """Remove one notice (or all when notice_id is None)."""
    try:
        redis = await get_redis()
        key = _KEY.format(user_id=user_id)
        if notice_id is None:
            await redis.delete(key)
            return
        raw = await redis.lrange(key, 0, _MAX - 1)
        for item in raw:
            if json.loads(item).get("id") == notice_id:
                await redis.lrem(key, 1, item)
                break
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to mark in-app notice read: %s", e)
