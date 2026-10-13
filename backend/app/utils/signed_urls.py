import hashlib
import hmac
import time

from app.config import get_settings

DEFAULT_EXPIRY_SECONDS = 3600

IMAGES_PATH_PREFIX = "/api/v1/images/"


def _get_image_signing_key() -> bytes:
    settings = get_settings()
    return hmac.new(settings.secret_key.encode(), b"image-url-signing", hashlib.sha256).digest()


def bare_image_path(path: str) -> str:
    """Reduce a stored image reference to its bare ``{user_id}/{filename}`` form.

    DB rows have held both the bare path and a signed ``/api/v1/images/...?expires=..&sig=..``
    URL over time, so callers must treat the two (and already double-signed values) as the
    same file. Absolute URLs are returned unchanged.
    """
    if path.startswith("http"):
        return path
    while path.startswith(IMAGES_PATH_PREFIX):
        path = path[len(IMAGES_PATH_PREFIX) :]
    return path.split("?", 1)[0]


def sign_image_url(path: str, expiry_seconds: int = DEFAULT_EXPIRY_SECONDS) -> str:
    """Sign an image URL and return a relative API path.

    Idempotent: re-signing an already-signed storage ref produces a freshly signed URL
    rather than a nested one, so responses can safely sign whatever the DB holds.
    Absolute (legacy http) URLs pass through unchanged.

    When a public base URL is needed (e.g. for DashScope), the caller should
    ensure OSS or another public hosting path is used instead of tunnel URLs.
    """
    if path.startswith("http"):
        return path
    path = bare_image_path(path)
    expires = int(time.time()) + expiry_seconds

    message = f"{path}:{expires}"
    signature = hmac.new(_get_image_signing_key(), message.encode(), hashlib.sha256).hexdigest()[
        :32
    ]

    return f"{IMAGES_PATH_PREFIX}{path}?expires={expires}&sig={signature}"


def verify_signature(path: str, expires: str, signature: str) -> bool:
    try:
        expiry_time = int(expires)
        if time.time() > expiry_time:
            return False
    except (ValueError, TypeError):
        return False

    message = f"{path}:{expires}"
    expected_signature = hmac.new(
        _get_image_signing_key(), message.encode(), hashlib.sha256
    ).hexdigest()[:32]

    return hmac.compare_digest(signature, expected_signature)
