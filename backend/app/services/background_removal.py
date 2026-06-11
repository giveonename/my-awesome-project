import logging
from abc import ABC, abstractmethod
from io import BytesIO

import httpx
from PIL import Image

from app.config import get_settings

logger = logging.getLogger(__name__)


class BackgroundRemovalProvider(ABC):
    @abstractmethod
    def remove(self, image: Image.Image) -> Image.Image:
        """Remove background from image. Returns RGBA image with transparent background."""


class RembgProvider(BackgroundRemovalProvider):
    """Stub – rembg has been removed. Raises an error directing callers to Aliyun."""

    def remove(self, image: Image.Image) -> Image.Image:
        raise RuntimeError(
            "rembg removed, use AliyunVisionService.segment_commodity instead"
        )


class AliyunVisionProvider(BackgroundRemovalProvider):
    """Background removal via Aliyun SegmentCommodity API."""

    def remove(self, image: Image.Image) -> Image.Image:
        from app.services.aliyun_vision_service import get_vision_service

        buf = BytesIO()
        image.save(buf, format="PNG")
        buf.seek(0)

        service = get_vision_service()
        result_bytes = service.segment_commodity(buf.getvalue())

        return Image.open(BytesIO(result_bytes)).convert("RGBA")


class HttpProvider(BackgroundRemovalProvider):
    def __init__(self, url: str, api_key: str | None = None):
        self.url = url.rstrip("/")
        self.api_key = api_key

    def remove(self, image: Image.Image) -> Image.Image:
        buf = BytesIO()
        image.save(buf, format="PNG")
        buf.seek(0)

        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        with httpx.Client(timeout=120, follow_redirects=True) as client:
            response = client.post(
                f"{self.url}/api/remove-background",
                files={"file": ("image.png", buf, "image/png")},
                headers=headers,
            )
            response.raise_for_status()

        return Image.open(BytesIO(response.content)).convert("RGBA")


_provider: BackgroundRemovalProvider | None = None


def get_provider() -> BackgroundRemovalProvider:
    global _provider
    if _provider is not None:
        return _provider

    settings = get_settings()
    provider_type = settings.bg_removal_provider

    if provider_type == "rembg":
        logger.warning("BG_REMOVAL_PROVIDER=rembg is deprecated; switching to aliyun")
        _provider = AliyunVisionProvider()
    elif provider_type == "aliyun":
        _provider = AliyunVisionProvider()
    elif provider_type == "http":
        if not settings.bg_removal_url:
            raise ValueError("BG_REMOVAL_URL is required when BG_REMOVAL_PROVIDER=http")
        _provider = HttpProvider(url=settings.bg_removal_url, api_key=settings.bg_removal_api_key)
    else:
        raise ValueError(
            f"Unknown BG_REMOVAL_PROVIDER: {provider_type}. Use 'aliyun' or 'http'."
        )

    return _provider
