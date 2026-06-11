"""
Image preprocessing service for virtual try-on pipeline.

Provides:
  - AliyunVisionService class using Alibaba Cloud Vision Intelligence 3.0 SDK
  - segment_commodity: flat-lay clothing background removal (SegmentCommodity API)
  - segment_commodity_items: flat-lay multi-item segmentation via commodity + PIL
  - parse_avatar / segment_cloth: person photo garment segmentation (SegmentCloth API)

Strategy:
  - Alibaba Cloud 3.0 SDK (imageseg) — the primary segmentation backend.
  - Images are auto-resized to fit API limits before submission.
  - For flat-lay multi-item photos: SegmentCommodity + PIL connected-component cropping.
  - Never crash the backend — all exceptions are caught and logged.
"""

import asyncio
import base64
import logging
import urllib.request
from io import BytesIO

import httpx
from PIL import Image

from app.config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# API image limits (from Aliyun docs)
# ---------------------------------------------------------------------------
SEGMENT_CLOTH_MAX_DIMENSION = 3000   # px, longest side
SEGMENT_CLOTH_MAX_BYTES = 3 * 1024 * 1024  # 3 MB
SEGMENT_COMMODITY_MAX_DIMENSION = 2000  # px, longest side
SEGMENT_COMMODITY_MAX_BYTES = 3 * 1024 * 1024  # 3 MB

SEGMENT_BODY_MAX_DIMENSION = 1500   # px, SegmentBody has stricter limits
SEGMENT_BODY_MAX_BYTES = 2 * 1024 * 1024  # 2 MB

def _resize_for_api(
    image_bytes: bytes,
    max_dimension: int,
    max_bytes: int,
) -> bytes:
    """Resize image to fit within API limits.

    - Scales longest side down to ``max_dimension`` if it exceeds it.
    - Preserves the original format (PNG stays PNG, JPEG stays JPEG).
    - Only compresses when the file size exceeds ``max_bytes``.
    """
    try:
        img = Image.open(BytesIO(image_bytes))
    except Exception:
        logger.warning("Cannot open image for resizing, returning original")
        return image_bytes

    orig_size_kb = len(image_bytes) / 1024
    logger.info(
        "Original image: %dx%d, mode=%s, %.0f KB",
        img.width, img.height, img.mode, orig_size_kb,
    )

    needs_resize = max(img.width, img.height) > max_dimension
    needs_compress = len(image_bytes) > max_bytes

    if not needs_resize and not needs_compress:
        return image_bytes

    if needs_resize:
        ratio = max_dimension / max(img.width, img.height)
        new_w = int(img.width * ratio)
        new_h = int(img.height * ratio)
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        logger.info("Resized to %dx%d", new_w, new_h)

    original_is_png = image_bytes[:4] == b'\x89PNG'
    output_format = "PNG" if original_is_png else "JPEG"

    if output_format == "PNG":
        buf = BytesIO()
        save_img = img if img.mode == "RGBA" else img.convert("RGBA")
        save_img.save(buf, format="PNG", optimize=True)
        result = buf.getvalue()
        if len(result) <= max_bytes:
            logger.info("Saved as PNG, %.0f KB", len(result) / 1024)
            return result
        logger.warning("PNG too large (%.0f KB), converting to JPEG", len(result) / 1024)
        if img.mode in ("RGBA", "P", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            src = img.convert("RGBA") if img.mode != "RGBA" else img
            bg.paste(src, mask=src.split()[3])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        output_format = "JPEG"
    else:
        if img.mode in ("RGBA", "P", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            src = img.convert("RGBA") if img.mode != "RGBA" else img
            bg.paste(src, mask=src.split()[3])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

    for quality in (92, 80, 65, 50):
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        result = buf.getvalue()
        if len(result) <= max_bytes:
            logger.info("Saved as JPEG quality=%d, %.0f KB", quality, len(result) / 1024)
            return result

    logger.warning("Could not meet size limit, returning smallest attempt")
    return result


# ---------------------------------------------------------------------------
# PIL connected-component splitting
# ---------------------------------------------------------------------------

def _split_transparent_image(
    transparent_png_bytes: bytes,
    min_area: int = 5000,
    padding: int = 20,
) -> list[bytes]:
    """Split a transparent RGBA PNG into individual foreground regions.

    Uses connected-component analysis on the alpha channel to find
    separate clothing items, then crops each with optional padding.
    Automatically merges paired items (shoes, earrings, gloves, etc.)
    that are visually similar and spatially close.

    Args:
        transparent_png_bytes: PNG bytes with transparent background.
        min_area: Minimum pixel area to consider a region as a garment.
        padding: Padding in pixels to add around each cropped region.

    Returns:
        List of PNG bytes, one per detected garment region.
    """
    img = Image.open(BytesIO(transparent_png_bytes)).convert("RGBA")
    alpha = img.split()[3]

    # Binary threshold: non-transparent pixels = 1, transparent = 0
    binary = alpha.point(lambda p: 255 if p > 10 else 0, mode="1")

    # Find connected components via flood-fill
    width, height = img.size
    visited = Image.new("1", (width, height), 0)
    regions: list[bytes] = []

    # Collect metadata for each region (for pair-merging)
    region_meta: list[dict] = []

    from collections import deque

    for y in range(height):
        for x in range(width):
            if visited.getpixel((x, y)):
                continue
            if not binary.getpixel((x, y)):
                visited.putpixel((x, y), 1)
                continue

            # BFS flood fill to find connected region
            min_x, min_y = x, y
            max_x, max_y = x, y
            queue = deque([(x, y)])
            visited.putpixel((x, y), 1)
            pixels = [(x, y)]

            while queue:
                cx, cy = queue.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < width and 0 <= ny < height and not visited.getpixel((nx, ny)):
                        visited.putpixel((nx, ny), 1)
                        if binary.getpixel((nx, ny)):
                            queue.append((nx, ny))
                            pixels.append((nx, ny))
                            min_x = min(min_x, nx)
                            min_y = min(min_y, ny)
                            max_x = max(max_x, nx)
                            max_y = max(max_y, ny)

            area = len(pixels)
            if area < min_area:
                continue

            region_meta.append({
                "pixels": pixels,
                "bbox": (min_x, min_y, max_x, max_y),
                "area": area,
            })

    logger.info("Found %d raw regions before pair-merging", len(region_meta))

    # --- Merge paired items (shoes, earrings, gloves, etc.) ---
    # Two regions are "pair candidates" if they:
    #   1. Have similar area (ratio < 2.5)
    #   2. Have similar aspect ratio (difference < 0.5)
    #   3. Are horizontally separated (side-by-side, not stacked)
    #   4. Have similar vertical center (within 25% of image height)
    #   5. Are both "small" items (< 20% of total image area)
    total_area = width * height
    pair_threshold_area = total_area * 0.20  # items smaller than 20% of image

    merged_flags = [False] * len(region_meta)

    for i in range(len(region_meta)):
        if merged_flags[i]:
            continue
        ri = region_meta[i]
        if ri["area"] > pair_threshold_area:
            continue  # large item (shirt, pants) — skip

        bi = ri["bbox"]
        wi = bi[2] - bi[0]
        hi = bi[3] - bi[1]
        if wi == 0 or hi == 0:
            continue
        ar_i = wi / hi
        cy_i = (bi[1] + bi[3]) / 2

        for j in range(i + 1, len(region_meta)):
            if merged_flags[j]:
                continue
            rj = region_meta[j]
            if rj["area"] > pair_threshold_area:
                continue

            bj = rj["bbox"]
            wj = bj[2] - bj[0]
            hj = bj[3] - bj[1]
            if wj == 0 or hj == 0:
                continue
            ar_j = wj / hj
            cy_j = (bj[1] + bj[3]) / 2

            # Area similarity
            area_ratio = max(ri["area"], rj["area"]) / max(min(ri["area"], rj["area"]), 1)
            if area_ratio > 2.5:
                continue

            # Aspect ratio similarity
            if abs(ar_i - ar_j) > 0.5:
                continue

            # Vertical center similarity (within 25% of image height)
            if abs(cy_i - cy_j) > height * 0.25:
                continue

            # Horizontal gap check: the two regions should be side-by-side
            # with a reasonable gap (not too far apart)
            gap = max(0, max(bi[0], bj[0]) - min(bi[2], bj[2]))
            if gap > width * 0.4:
                continue

            # Merge: combine pixels from j into i
            logger.info(
                "Merging paired regions %d and %d (area=%d/%d, gap=%dpx)",
                i, j, ri["area"], rj["area"], gap,
            )
            ri["pixels"].extend(rj["pixels"])
            ri["bbox"] = (
                min(bi[0], bj[0]),
                min(bi[1], bj[1]),
                max(bi[2], bj[2]),
                max(bi[3], bj[3]),
            )
            ri["area"] += rj["area"]
            merged_flags[j] = True

    # Build final regions from (possibly merged) metadata
    for idx, meta in enumerate(region_meta):
        if merged_flags[idx]:
            continue

        min_x, min_y, max_x, max_y = meta["bbox"]
        pixels = meta["pixels"]
        area = meta["area"]

        # Crop with padding
        crop_left = max(0, min_x - padding)
        crop_top = max(0, min_y - padding)
        crop_right = min(width, max_x + padding + 1)
        crop_bottom = min(height, max_y + padding + 1)

        cropped = img.crop((crop_left, crop_top, crop_right, crop_bottom))

        # Rebuild alpha: only keep pixels in this region
        region_mask = Image.new("1", (width, height), 0)
        for px, py in pixels:
            region_mask.putpixel((px, py), 255)
        region_mask_cropped = region_mask.crop(
            (crop_left, crop_top, crop_right, crop_bottom)
        )

        # Combine: take original RGB + region-only alpha
        # Ensure RGBA mode for consistent channel extraction
        if cropped.mode != "RGBA":
            cropped = cropped.convert("RGBA")
        r, g, b, _a = cropped.split()
        cropped_rgba = Image.merge("RGBA", (r, g, b, region_mask_cropped.convert("L")))

        buf = BytesIO()
        cropped_rgba.save(buf, format="PNG", optimize=True)
        regions.append(buf.getvalue())
        logger.info(
            "Found region: area=%d, bbox=(%d,%d,%d,%d), size=%dKB",
            area, crop_left, crop_top, crop_right, crop_bottom,
            len(buf.getvalue()) // 1024,
        )

    logger.info("Split transparent image into %d regions (after pair-merging)", len(regions))
    return regions


class AliyunVisionService:
    """Alibaba Cloud Vision Intelligence 3.0 SDK image segmentation service."""

    # Supported garment categories for avatar (person) segmentation
    AVATAR_CLOTH_CATEGORIES = ["tops", "coat", "pants", "skirt"]

    def __init__(self):
        self.settings = get_settings()
        self._imageseg_client = None

    def _get_imageseg_client(self):
        if self._imageseg_client is not None:
            return self._imageseg_client
        from alibabacloud_imageseg20191230.client import Client as ImagesegClient
        from alibabacloud_tea_openapi.models import Config
        config = Config(
            access_key_id=self.settings.aliyun_access_key_id,
            access_key_secret=self.settings.aliyun_access_key_secret,
            endpoint=self.settings.aliyun_vision_endpoint,
        )
        self._imageseg_client = ImagesegClient(config)
        return self._imageseg_client

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def segment_commodity(self, image_bytes: bytes) -> bytes:
        """Remove background from a flat-lay clothing image. Returns PNG bytes."""
        prepared = _resize_for_api(
            image_bytes, SEGMENT_COMMODITY_MAX_DIMENSION, SEGMENT_COMMODITY_MAX_BYTES,
        )
        result = await asyncio.to_thread(self._segment_commodity_sync, prepared)
        if not result or len(result) == 0:
            raise RuntimeError("SegmentCommodity returned empty result")
        logger.info("SegmentCommodity succeeded, output size: %d bytes", len(result))
        return result

    async def segment_person(self, image_bytes: bytes) -> bytes:
        """Remove background from a person photo, keeping full body. Returns RGBA PNG bytes."""
        prepared = _resize_for_api(
            image_bytes, SEGMENT_BODY_MAX_DIMENSION, SEGMENT_BODY_MAX_BYTES,
        )
        result = await asyncio.to_thread(self._segment_body_sync, prepared)
        if not result or len(result) == 0:
            raise RuntimeError("SegmentBody returned empty result")
        logger.info("SegmentBody succeeded, output size: %d bytes", len(result))
        return result

    def _segment_body_sync(self, image_bytes: bytes) -> bytes | None:
        """Synchronous SegmentBody API call."""
        from alibabacloud_imageseg20191230 import models as imageseg_models
        from alibabacloud_tea_util.models import RuntimeOptions
        from io import BytesIO
        client = self._get_imageseg_client()
        runtime = RuntimeOptions()
        runtime.read_timeout = 30000
        runtime.connect_timeout = 10000
        request = imageseg_models.SegmentBodyAdvanceRequest()
        request.image_urlobject = BytesIO(image_bytes)
        response = client.segment_body_advance(request, runtime)
        body = response.body
        logger.info("SegmentBody request_id: %s", getattr(body, "request_id", "N/A"))
        if not body or not body.data:
            raise RuntimeError("SegmentBody returned empty body")
        image_url = body.data.image_url
        if not image_url:
            raise RuntimeError("SegmentBody returned no image_url")
        import httpx as _httpx
        img_resp = _httpx.get(image_url, timeout=30)
        return img_resp.content

    async def segment_commodity_items(
        self, image_bytes: bytes, min_area: int = 5000,
    ) -> dict[str, bytes]:
        """Segment a flat-lay multi-item photo into individual garment PNGs.

        Pipeline:
          1. Run SegmentCommodity to get transparent foreground.
          2. Use PIL connected-component analysis to split into regions.
          3. Return dict mapping "item_0", "item_1", ... to PNG bytes.

        Falls back to a single "item_0" if splitting finds nothing.
        """
        transparent = await self.segment_commodity(image_bytes)
        regions = _split_transparent_image(transparent, min_area=min_area)
        if not regions:
            logger.warning("No regions found by connected components, returning whole image")
            return {"item_0": transparent}
        layers = {f"item_{i}": png for i, png in enumerate(regions)}
        logger.info("segment_commodity_items produced %d items", len(layers))
        return layers

    async def parse_avatar(self, image_bytes: bytes) -> dict[str, bytes]:
        """Segment clothing from a person/flat-lay photo using SegmentCloth (single call, no cloth_class).

        Returns dict mapping category names to PNG bytes (including full_body).
        """
        import time

        prepared = _resize_for_api(
            image_bytes, SEGMENT_BODY_MAX_DIMENSION, SEGMENT_BODY_MAX_BYTES,
        )
        result = await asyncio.to_thread(self._segment_cloth_sync, prepared)
        if not result:
            raise RuntimeError("SegmentCloth returned no garment elements")
        logger.info("SegmentCloth succeeded, layers: %s", list(result.keys()))
        return result

    async def segment_avatar_items(
        self, image_bytes: bytes,
        categories: list[str | None] | None = None,
    ) -> dict[str, bytes]:
        """Segment a person/outfit photo into individual garment PNGs.

        Reduced main categories for performance testing.
        Default categories: [None, "tops", "coat", "pants", "skirt"].

        Returns dict with keys like "full_body", "tops", "pants", etc.
        """
        import time
        prepared = _resize_for_api(
            image_bytes, SEGMENT_BODY_MAX_DIMENSION, SEGMENT_BODY_MAX_BYTES,
        )

        result: dict[str, bytes] = {}
        if categories is None:
            categories = [None, "tops", "coat", "pants", "skirt"]

        total_t0 = time.perf_counter()
        for idx, cat in enumerate(categories, start=1):
            key = cat or "full_body"
            t0 = time.perf_counter()
            try:
                # Each call gets a fresh BytesIO copy to avoid stream position issues
                await asyncio.sleep(0.6)  # QPS throttle: max 2/s
                png_bytes = await asyncio.to_thread(
                    self._segment_cloth_single_sync,
                    BytesIO(prepared),
                    cat,
                )
                elapsed = time.perf_counter() - t0
                if not png_bytes or len(png_bytes) < 1000:
                    logger.info("Category '%s': not detected (%.2fs)", key, elapsed)
                    continue
                # Sanity check: skip if almost entirely transparent
                try:
                    check_img = Image.open(BytesIO(png_bytes)).convert("RGBA")
                    alpha = check_img.split()[3]
                    non_zero = sum(1 for p in alpha.getdata() if p > 10)
                    total_pixels = check_img.width * check_img.height
                    if non_zero < total_pixels * 0.01:
                        logger.info("Category '%s': <1%% non-transparent, skipping (%.2fs)", key, elapsed)
                        continue
                except Exception:
                    pass
                result[key] = png_bytes
                logger.info("Category '%s': %d bytes (%.2fs)", key, len(png_bytes), elapsed)
            except Exception as e:
                logger.warning("Category '%s' failed (%.2fs): %s", key, time.perf_counter() - t0, e)

        logger.info(
            "segment_avatar_items produced %d layers in %.2fs: %s",
            len(result), time.perf_counter() - total_t0, list(result.keys()),
        )
        return result

    # ------------------------------------------------------------------
    # Private: synchronous SDK wrappers
    # ------------------------------------------------------------------

    def _segment_commodity_sync(self, image_bytes: bytes) -> bytes | None:
        from alibabacloud_imageseg20191230 import models as imageseg_models
        from alibabacloud_tea_util.models import RuntimeOptions
        client = self._get_imageseg_client()
        runtime = RuntimeOptions()
        runtime.read_timeout = 30000
        runtime.connect_timeout = 10000
        request = imageseg_models.SegmentCommodityAdvanceRequest()
        request.image_urlobject = BytesIO(image_bytes)
        response = client.segment_commodity_advance(request, runtime)
        body = response.body
        logger.info("SegmentCommodity request_id: %s", getattr(body, "request_id", "N/A"))
        if not body or not body.data:
            logger.error("SegmentCommodity returned empty body")
            return None
        image_url = body.data.image_url
        if image_url:
            with urllib.request.urlopen(image_url, timeout=30) as resp:
                return resp.read()
        return None

    def _segment_cloth_single_sync(
        self, prepared: bytes | BytesIO, cloth_class: str | None = None,
    ) -> bytes | None:
        """Synchronous SegmentCloth call for a single category.

        Args:
            prepared: Already-resized image bytes or BytesIO object.
            cloth_class: e.g. "tops", "pants". None for full_body (no filter).

        Returns:
            PNG bytes or None if nothing detected.
        """
        from alibabacloud_imageseg20191230 import models as imageseg_models
        from alibabacloud_tea_util.models import RuntimeOptions
        client = self._get_imageseg_client()
        runtime = RuntimeOptions()
        runtime.read_timeout = 30000
        runtime.connect_timeout = 10000
        request = imageseg_models.SegmentClothAdvanceRequest()
        request.image_urlobject = prepared if isinstance(prepared, BytesIO) else BytesIO(prepared)
        if cloth_class:
            request.cloth_class = [cloth_class]
        response = client.segment_cloth_advance(request, runtime)
        body = response.body
        if not body or not body.data:
            return None
        elements = getattr(body.data, "elements", None) or []
        for element in elements:
            image_url = getattr(element, "image_url", None)
            if image_url:
                with urllib.request.urlopen(image_url, timeout=30) as resp:
                    return resp.read()
        return None

    def _segment_cloth_sync(self, image_bytes: bytes) -> dict[str, bytes] | None:
        """Call SegmentCloth without cloth_class (returns full foreground + class_url layers)."""
        from alibabacloud_imageseg20191230 import models as imageseg_models
        from alibabacloud_tea_util.models import RuntimeOptions
        client = self._get_imageseg_client()
        runtime = RuntimeOptions()
        runtime.read_timeout = 30000
        runtime.connect_timeout = 10000
        request = imageseg_models.SegmentClothAdvanceRequest()
        request.image_urlobject = BytesIO(image_bytes)
        response = client.segment_cloth_advance(request, runtime)
        body = response.body
        if not body or not body.data:
            logger.error("SegmentCloth returned empty body")
            return None
        data = body.data
        layers: dict[str, bytes] = {}
        elements = getattr(data, "elements", None) or []
        for element in elements:
            image_url = getattr(element, "image_url", None)
            if image_url:
                try:
                    with urllib.request.urlopen(image_url, timeout=30) as resp:
                        layers["full_body"] = resp.read()
                    logger.info("Downloaded SegmentCloth full_body, %d bytes", len(layers["full_body"]))
                except Exception as dl_exc:
                    logger.warning("Failed to download SegmentCloth image_url: %s", dl_exc)
            class_url = getattr(element, "class_url", None)
            if class_url and isinstance(class_url, dict):
                for cat, url in class_url.items():
                    if url and cat not in layers:
                        try:
                            with urllib.request.urlopen(url, timeout=30) as resp:
                                layers[cat] = resp.read()
                            logger.info("Downloaded SegmentCloth layer '%s', %d bytes", cat, len(layers[cat]))
                        except Exception as dl_exc:
                            logger.warning("Failed to download SegmentCloth layer '%s': %s", cat, dl_exc)
        if layers:
            logger.info("SegmentCloth produced %d layers: %s", len(layers), list(layers.keys()))
        return layers if layers else None

async def remove_background(image_bytes: bytes) -> bytes:
    service = AliyunVisionService()
    return await service.segment_commodity(image_bytes)

async def segment_commodity(image_bytes: bytes) -> bytes:
    service = AliyunVisionService()
    return await service.segment_commodity(image_bytes)

async def parse_avatar(image_bytes: bytes) -> dict[str, bytes]:
    service = AliyunVisionService()
    return await service.parse_avatar(image_bytes)

async def segment_body(image_bytes: bytes) -> bytes:
    service = AliyunVisionService()
    result = await service.parse_avatar(image_bytes)
    return _pick_primary_layer(result)

def _pick_primary_layer(layers: dict[str, bytes]) -> bytes:
    for key in ("tops", "top", "upper_body", "upper", "upperBody"):
        if key in layers:
            return layers[key]
    if layers:
        return next(iter(layers.values()))
    return b""

async def download_image(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content

def image_bytes_to_base64(image_bytes: bytes, mime: str = "image/png") -> str:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime};base64,{b64}"










