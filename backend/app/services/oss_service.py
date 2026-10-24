"""Alibaba Cloud OSS service for storing and serving images publicly.

Provides:
  - OssService class for upload/delete/list operations
  - Automatic upload of all image sizes (original, medium, thumbnail)
  - Public URL generation for DashScope / frontend access

Requires oss2 package (pip install oss2).
"""

import logging
from pathlib import Path

try:
    import oss2
except ImportError:
    oss2 = None  # Will be checked at runtime in OssService.__init__

from app.config import get_settings

logger = logging.getLogger(__name__)


class OssService:
    """Alibaba Cloud OSS client for wardrobe image storage."""

    def __init__(self):
        settings = get_settings()
        self.bucket_name = settings.aliyun_oss_bucket
        self.endpoint = settings.aliyun_oss_endpoint
        self.public_url_base = settings.aliyun_oss_public_url

        if not self.bucket_name or not self.endpoint:
            raise ValueError("OSS not configured: set ALIYUN_OSS_BUCKET and ALIYUN_OSS_ENDPOINT")

        if not settings.aliyun_access_key_id or not settings.aliyun_access_key_secret:
            raise ValueError(
                "OSS credentials not configured: set ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET"
            )

        if oss2 is None:
            raise ImportError("oss2 package not installed. Run: pip install oss2")

        auth = oss2.Auth(
            settings.aliyun_access_key_id,
            settings.aliyun_access_key_secret,
        )
        self.bucket = oss2.Bucket(auth, self.endpoint, self.bucket_name)

    def _build_object_key(self, user_id: str, filename: str) -> str:
        """Build the OSS object key for a user's image."""
        return f"images/{user_id}/{filename}"

    def upload_bytes(
        self,
        data: bytes,
        object_key: str,
        content_type: str = "image/jpeg",
    ) -> str:
        """Upload raw bytes to OSS and return the public URL.

        Args:
            data: Image bytes to upload.
            object_key: OSS object key (e.g. "images/user_id/file.jpg").
            content_type: MIME type for the upload.

        Returns:
            Public HTTPS URL for the uploaded object.
        """
        headers = {"Content-Type": content_type}
        self.bucket.put_object(object_key, data, headers=headers)
        url = f"{self.public_url_base}/{object_key}"
        logger.info("Uploaded to OSS: %s (%d bytes)", object_key, len(data))
        return url

    def upload_file(
        self,
        local_path: str | Path,
        object_key: str,
        content_type: str = "image/jpeg",
    ) -> str:
        """Upload a local file to OSS and return the public URL."""
        local_path = Path(local_path)
        with open(local_path, "rb") as f:
            data = f.read()
        return self.upload_bytes(data, object_key, content_type)

    def delete_object(self, object_key: str) -> None:
        """Delete a single object from OSS."""
        try:
            self.bucket.delete_object(object_key)
            logger.info("Deleted from OSS: %s", object_key)
        except Exception as e:
            logger.warning("Failed to delete OSS object %s: %s", object_key, e)

    def delete_objects(self, object_keys: list[str]) -> None:
        """Delete multiple objects from OSS (batch)."""
        if not object_keys:
            return
        try:
            self.bucket.batch_delete_objects(object_keys)
            logger.info("Batch deleted %d objects from OSS", len(object_keys))
        except Exception as e:
            logger.warning("Failed to batch delete OSS objects: %s", e)

    def upload_image_sizes(
        self,
        user_id: str,
        local_paths: dict[str, str],
        storage_path: str,
    ) -> dict[str, str]:
        """Upload all image sizes (original, medium, thumbnail) to OSS.

        Args:
            user_id: User ID string.
            local_paths: Dict with "image_path", "medium_path", "thumbnail_path" keys
                         containing relative local paths.
            storage_path: Base storage path on disk.

        Returns:
            Dict with "public_url", "public_url_medium", "public_url_thumbnail" keys.
        """
        result: dict[str, str] = {}

        for size_key, oss_key in [
            ("image_path", "public_url"),
            ("medium_path", "public_url_medium"),
            ("thumbnail_path", "public_url_thumbnail"),
        ]:
            rel_path = local_paths.get(size_key)
            if not rel_path:
                continue

            full_path = Path(storage_path) / rel_path
            if not full_path.exists():
                logger.warning("Local file not found for OSS upload: %s", full_path)
                continue

            # Determine content type
            ext = full_path.suffix.lower()
            content_type = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
            }.get(ext, "image/jpeg")

            # Build object key preserving user directory structure
            object_key = f"images/{rel_path}"
            try:
                url = self.upload_file(full_path, object_key, content_type)
                result[oss_key] = url
            except Exception as e:
                logger.error("Failed to upload %s to OSS: %s", rel_path, e)

        return result

    def upload_png_bytes(
        self,
        user_id: str,
        image_data: bytes,
        filename: str,
    ) -> str:
        """Upload PNG bytes directly to OSS (for segmented garment images).

        Returns:
            Public URL of the uploaded PNG.
        """
        object_key = f"images/{user_id}/{filename}"
        return self.upload_bytes(image_data, object_key, content_type="image/png")


def is_oss_configured() -> bool:
    """Check if OSS is configured (has bucket and endpoint)."""
    settings = get_settings()
    return bool(settings.aliyun_oss_bucket and settings.aliyun_oss_endpoint)


def get_oss_service() -> OssService | None:
    """Get an OssService instance if configured, else None."""
    if not is_oss_configured():
        return None
    try:
        return OssService()
    except Exception as e:
        logger.warning("Failed to initialize OssService: %s", e)
        return None
