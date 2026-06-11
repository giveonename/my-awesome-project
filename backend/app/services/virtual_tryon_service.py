"""
Virtual Try-On service using Alibaba Cloud DashScope OutfitAnyone API.

Official API documentation:
  - aitryon: https://help.aliyun.com/zh/model-studio/outfitanyone-api
  - aitryon-plus: https://help.aliyun.com/zh/model-studio/aitryon-plus-api
  - aitryon-refiner: https://help.aliyun.com/zh/model-studio/ai-fitting-picture-finishing-api-details
  - aitryon-parsing-v1: https://help.aliyun.com/zh/model-studio/aitryon-parsing-api

Key API facts (from official docs):
  - All images must be PUBLIC HTTP/HTTPS URLs (no local paths, no data URIs)
  - Request fields: person_image_url + top_garment_url + bottom_garment_url
  - Required parameters: resolution (-1), restore_face (true)
  - Response: output.image_url (string, valid for 24h)
  - Task endpoint: POST .../services/aigc/image2image/image-synthesis
  - Poll endpoint: GET .../tasks/{task_id}
  - Parsing endpoint: POST .../services/vision/image-process/process
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)

# Official default images from DashScope docs (for testing/demo)
DEFAULT_PERSON_URL = "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250626/ubznva/model_person.png"
DEFAULT_TOP_GARMENT_URL = "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250626/epousa/short_sleeve.jpeg"
DEFAULT_BOTTOM_GARMENT_URL = "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250626/rchumi/pants.jpeg"


@dataclass
class TryOnResult:
    """Result of a virtual try-on request."""
    success: bool
    image_url: str | None = None
    task_id: str | None = None
    model_used: str | None = None
    error: str | None = None
    elapsed_seconds: float = 0.0


@dataclass
class TryOnTask:
    """In-memory task tracker for polling."""
    task_id: str
    status: str = "PENDING"
    image_url: str | None = None
    error: str | None = None
    model_used: str = ""
    created_at: float = field(default_factory=time.time)


# In-memory task store
_tasks: dict[str, TryOnTask] = {}

# Item type classification for garment_url mapping
_TOP_TYPES: set[str] = {
    "shirt", "t-shirt", "sweater", "hoodie", "blazer", "jacket", "coat", "top",
    "dress", "vest", "cardigan", "polo", "blouse", "tank-top",
}
_BOTTOM_TYPES: set[str] = {
    "pants", "jeans", "shorts", "skirt",
}
_OUTFIT_TYPES: set[str] = {"outfit", "full_body", "jumpsuit"}


def _get_headers() -> dict[str, str]:
    """Build DashScope API headers."""
    settings = get_settings()
    return {
        "Authorization": f"Bearer {settings.dashscope_api_key}",
        "Content-Type": "application/json",
    }


def _classify_garment_urls(garment_urls: list[str]) -> dict[str, str]:
    """Legacy: classify URLs by position (first=top, second=bottom)."""
    input_data: dict[str, str] = {}
    if len(garment_urls) >= 2:
        input_data["top_garment_url"] = garment_urls[0]
        input_data["bottom_garment_url"] = garment_urls[1]
    elif len(garment_urls) == 1:
        input_data["top_garment_url"] = garment_urls[0]
    return input_data


def _is_top_type(item_type: str | None) -> bool:
    """Check if an item type is a top/upper garment."""
    return bool(item_type) and item_type.lower() in _TOP_TYPES


def _is_bottom_type(item_type: str | None) -> bool:
    """Check if an item type is a bottom/lower garment."""
    return bool(item_type) and item_type.lower() in _BOTTOM_TYPES


def _is_outfit_type(item_type: str | None) -> bool:
    """Check if an item type is a full outfit (avatar-sourced combo)."""
    return bool(item_type) and item_type.lower() in _OUTFIT_TYPES


async def resolve_garment_input(
    items: list[dict],
) -> dict[str, str]:
    """Resolve garment items into DashScope API input fields.

    Each item dict should have: {"url": str, "type": str, "source_scene": str}

    Scenarios:
      1. Two items, one top + one bottom -> assign directly
      2. Single item, explicit top or bottom type -> assign to correct slot
      3. Single item, outfit/full_body type -> call parsing-v1 to split
      4. Fallback -> first item as top

    Returns dict with "top_garment_url" and/or "bottom_garment_url".
    """
    if not items:
        return {}

    # Scenario 1: Multiple items -- classify each by type
    if len(items) >= 2:
        input_data: dict[str, str] = {}
        for item in items:
            url = item.get("url", "")
            item_type = item.get("type", "")
            if not url:
                continue
            if _is_bottom_type(item_type) and "bottom_garment_url" not in input_data:
                input_data["bottom_garment_url"] = url
            elif _is_top_type(item_type) and "top_garment_url" not in input_data:
                input_data["top_garment_url"] = url
            elif "top_garment_url" not in input_data:
                input_data["top_garment_url"] = url
            elif "bottom_garment_url" not in input_data:
                input_data["bottom_garment_url"] = url
        return input_data

    # Single item
    single = items[0]
    url = single.get("url", "")
    item_type = single.get("type", "")
    if not url:
        return {}

    # Scenario 2a: Explicit bottom type
    if _is_bottom_type(item_type):
        return {"bottom_garment_url": url}

    # Scenario 2b: Explicit top type (including dress)
    if _is_top_type(item_type):
        return {"top_garment_url": url}

    # Scenario 3: Outfit/full_body -- use parsing-v1 to split
    if _is_outfit_type(item_type):
        try:
            logger.info("Outfit item detected, calling parsing-v1 to split: %s", url[:80])
            parsed = await parse_garment_regions(url)
            crop_urls = parsed.get("crop_img_url", [])
            if len(crop_urls) >= 2:
                logger.info("Parsing-v1 split into %d crops", len(crop_urls))
                return {
                    "top_garment_url": crop_urls[0],
                    "bottom_garment_url": crop_urls[1],
                }
            elif len(crop_urls) == 1:
                logger.info("Parsing-v1 returned single crop, using as top")
                return {"top_garment_url": crop_urls[0]}
            else:
                logger.warning("Parsing-v1 returned no crops, falling back to original as top")
                return {"top_garment_url": url}
        except Exception as e:
            logger.warning("Parsing-v1 failed for outfit, using original as top: %s", e)
            return {"top_garment_url": url}

    # Scenario 4: Unknown type -- default to top
    return {"top_garment_url": url}


async def submit_tryon_task(
    person_image_url: str,
    garment_urls: list[str],
    model: str | None = None,
    garment_input: dict[str, str] | None = None,
) -> TryOnTask:
    """
    Submit a virtual try-on task to DashScope (async mode).

    Official request format:
    {
        "model": "aitryon-plus",
        "input": {
            "person_image_url": "...",
            "top_garment_url": "...",
            "bottom_garment_url": "..."
        },
        "parameters": {
            "resolution": -1,
            "restore_face": true
        }
    }
    """
    settings = get_settings()
    model_name = model or settings.dashscope_tryon_model
    url = f"{settings.dashscope_base_url}/services/aigc/image2image/image-synthesis"

    headers = _get_headers()
    headers["X-DashScope-Async"] = "enable"

    # Build garment input (official format)
    if garment_input is None:
        garment_input = _classify_garment_urls(garment_urls)

    # Official request body
    payload = {
        "model": model_name,
        "input": {
            "person_image_url": person_image_url,
            **garment_input,
        },
        "parameters": {
            "resolution": -1,        # Match original image size
            "restore_face": True,    # Preserve original face
        },
    }

    # Verify all image URLs are accessible by DashScope
    all_image_urls = {"person": person_image_url, **garment_input}
    for url_key, img_url in all_image_urls.items():
        if not img_url or not img_url.startswith("http"):
            continue
        # Skip DashScope internal URLs (parsing-v1 crop results)
        if "dashscope" in img_url and "oss-cn-" in img_url:
            logger.info("  %s is DashScope internal URL, skipping reachability check", url_key)
            continue
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as check_client:
                head_resp = await check_client.head(img_url)
                logger.info("  %s reachability: HTTP %d", url_key, head_resp.status_code)
                if head_resp.status_code >= 400:
                    logger.error("Aborting try-on: %s returned HTTP %d", url_key, head_resp.status_code)
                    return TryOnTask(task_id="", status="FAILED", error=f"Image not accessible: {url_key} (HTTP {head_resp.status_code})", model_used=model_name)
        except Exception as ve:
            logger.error("Aborting try-on: %s", ve)
            return TryOnTask(task_id="", status="FAILED", error=f"Image not accessible: {url_key}", model_used=model_name)

    logger.info(
        "Submitting try-on: model=%s, person=%s, garments=%s",
        model_name, person_image_url[:80], list(garment_input.keys()),
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        data = response.json()

    if response.status_code != 200 or "output" not in data:
        error_msg = data.get("message", data.get("error", {}).get("message", "Unknown error"))
        code = data.get("code", "")
        logger.error("DashScope submit failed: %s — %s (%s)", response.status_code, error_msg, code)
        task = TryOnTask(task_id="", status="FAILED", error=f"{code}: {error_msg}", model_used=model_name)
        return task

    output = data["output"]
    task_id = output.get("task_id", "")
    status = output.get("task_status", "PENDING")

    task = TryOnTask(task_id=task_id, status=status, model_used=model_name)
    _tasks[task_id] = task

    logger.info("Try-on task submitted: task_id=%s, status=%s", task_id, status)
    return task


async def check_task_once(task_id: str) -> TryOnTask | None:
    """Single non-blocking check of DashScope task status."""
    settings = get_settings()
    url = f"{settings.dashscope_base_url}/tasks/{task_id}"
    headers = _get_headers()

    task = _tasks.get(task_id)
    if not task:
        task = TryOnTask(task_id=task_id)
        _tasks[task_id] = task

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
            data = response.json()

        output = data.get("output", {})
        task_status = output.get("task_status", "")

        if task_status == "SUCCEEDED":
            task.image_url = (output.get("image_url", "") or "").replace("http://", "https://")
            task.status = "SUCCEEDED"
            logger.info("Try-on completed: task_id=%s", task_id)
        elif task_status == "FAILED":
            code = output.get("code", "")
            message = output.get("message", "Task failed")
            task.status = "FAILED"
            task.error = f"{code}: {message}"
            logger.error("Try-on failed: task_id=%s, error=%s", task_id, task.error)
        else:
            task.status = task_status or "RUNNING"
    except Exception as e:
        logger.warning("Check error for task %s: %s", task_id, e)

    return task

async def poll_task(task_id: str, max_wait: int = 120, interval: float = 3.0) -> TryOnTask:
    """
    Poll DashScope task status until completed.

    Official poll endpoint: GET /api/v1/tasks/{task_id}
    Official response fields:
      output.task_status: PENDING/PRE-PROCESSING/RUNNING/POST-PROCESSING/SUCCEEDED/FAILED
      output.image_url: result image URL (24h validity)
      output.code: error code (on failure)
      output.message: error message (on failure)
    """
    settings = get_settings()
    url = f"{settings.dashscope_base_url}/tasks/{task_id}"
    headers = _get_headers()

    task = _tasks.get(task_id)
    if not task:
        task = TryOnTask(task_id=task_id)
        _tasks[task_id] = task

    start = time.time()
    while time.time() - start < max_wait:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(url, headers=headers)
                data = response.json()

            output = data.get("output", {})
            status = output.get("task_status", "")

            if status == "SUCCEEDED":
                # Official response: output.image_url (direct string)
                task.image_url = (output.get("image_url", "") or "").replace("http://", "https://")
                task.status = "SUCCEEDED"
                logger.info("Try-on completed: task_id=%s, image=%s", task_id, task.image_url[:80] if task.image_url else "None")
                return task

            elif status == "FAILED":
                code = output.get("code", "")
                message = output.get("message", "Task failed")
                task.status = "FAILED"
                task.error = f"{code}: {message}"
                logger.error("Try-on failed: task_id=%s, error=%s", task_id, task.error)
                return task

            # Still running (PENDING/PRE-PROCESSING/RUNNING/POST-PROCESSING)
            task.status = status or "RUNNING"

        except Exception as e:
            logger.warning("Poll error for task %s: %s", task_id, e)

        await asyncio.sleep(interval)

    # Timeout
    task.status = "FAILED"
    task.error = f"Timeout after {max_wait}s"
    logger.error("Try-on timed out: task_id=%s", task_id)
    return task


async def virtual_tryon(
    person_image_url: str,
    garment_urls: list[str],
    model: str | None = None,
    use_refiner: bool = False,
    garment_input: dict[str, str] | None = None,
) -> TryOnResult:
    """
    Full virtual try-on flow: submit → poll → optional refine.

    Args:
        person_image_url: Public HTTP/HTTPS URL of the person/model image
        garment_urls: Public HTTP/HTTPS URLs of garment images
        model: DashScope model name (aitryon or aitryon-plus)
        use_refiner: Whether to apply aitryon-refiner post-processing

    Returns:
        TryOnResult with image_url or error
    """
    settings = get_settings()
    start_time = time.time()

    if not settings.dashscope_api_key:
        return TryOnResult(success=False, error="DashScope API key not configured")

    # Step 1: Submit try-on task
    task = await submit_tryon_task(person_image_url, garment_urls, model, garment_input=garment_input)

    if task.status == "FAILED":
        return TryOnResult(
            success=False,
            task_id=task.task_id,
            model_used=task.model_used,
            error=task.error,
            elapsed_seconds=time.time() - start_time,
        )

    # Step 2: Poll for completion (aitryon-plus: ~90s)
    task = await poll_task(task.task_id, max_wait=settings.virtual_tryon_timeout)

    if task.status != "SUCCEEDED" or not task.image_url:
        return TryOnResult(
            success=False,
            task_id=task.task_id,
            model_used=task.model_used,
            error=task.error or "Try-on generation failed",
            elapsed_seconds=time.time() - start_time,
        )

    result_url = task.image_url

    # Step 3: Optional refinement with aitryon-refiner
    if use_refiner and result_url:
        refiner_result = await _refine_image(
            coarse_image_url=result_url,
            person_image_url=person_image_url,
            garment_urls=garment_urls,
        )
        if refiner_result:
            result_url = refiner_result

    elapsed = time.time() - start_time
    logger.info("Virtual try-on completed in %.1fs: %s", elapsed, result_url[:80])

    return TryOnResult(
        success=True,
        image_url=result_url,
        task_id=task.task_id,
        model_used=task.model_used,
        elapsed_seconds=elapsed,
    )


async def _refine_image(
    coarse_image_url: str,
    person_image_url: str,
    garment_urls: list[str],
) -> str | None:
    """
    Apply aitryon-refiner for image quality enhancement.

    Official request format:
    {
        "model": "aitryon-refiner",
        "input": {
            "top_garment_url": "...",
            "bottom_garment_url": "...",
            "person_image_url": "...",
            "coarse_image_url": "..."
        },
        "parameters": {
            "gender": "woman" or "man"
        }
    }
    """
    settings = get_settings()
    url = f"{settings.dashscope_base_url}/services/aigc/image2image/image-synthesis"

    headers = _get_headers()
    headers["X-DashScope-Async"] = "enable"

    garment_input = _classify_garment_urls(garment_urls)

    payload = {
        "model": settings.dashscope_refine_model,
        "input": {
            "person_image_url": person_image_url,
            "coarse_image_url": coarse_image_url,
            **garment_input,
        },
        "parameters": {
            "gender": "woman",  # Default; could be derived from user profile
        },
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            data = response.json()

        if response.status_code != 200 or "output" not in data:
            logger.warning("Refiner submit failed: %s", data.get("message", ""))
            return None

        output = data["output"]
        refiner_task_id = output.get("task_id", "")
        if not refiner_task_id:
            return None

        # Poll refiner task (shorter timeout — refiner is faster ~5-15s)
        refiner_task = await poll_task(refiner_task_id, max_wait=60)
        if refiner_task.status == "SUCCEEDED" and refiner_task.image_url:
            return refiner_task.image_url

    except Exception as e:
        logger.warning("Refinement failed: %s", e)

    return None


async def parse_garment_regions(image_url: str) -> dict:
    """
    Detect garment regions using aitryon-parsing-v1.

    Official endpoint: POST .../services/vision/image-process/process
    NOT the same as aitryon/aitryon-plus endpoint.

    Request:
    {
        "model": "aitryon-parsing-v1",
        "input": { "image_url": "..." },
        "parameters": { "clothes_type": ["upper", "lower"] }
    }

    Response:
    {
        "output": {
            "crop_img_url": ["url1", "url2"],
            "parsing_img_url": ["url1", "url2"],
            "bbox": [[x1,y1,x2,y2], ...]
        }
    }
    """
    settings = get_settings()
    if not settings.dashscope_api_key:
        raise ValueError("DashScope API key not configured")

    # IMPORTANT: Different endpoint for parsing!
    url = f"{settings.dashscope_base_url}/services/vision/image-process/process"

    headers = {
        "Authorization": f"Bearer {settings.dashscope_api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": settings.dashscope_parse_model,
        "input": {
            "image_url": image_url,
        },
        "parameters": {
            "clothes_type": ["upper", "lower"],
        },
    }

    logger.info("Submitting garment parsing for: %s", image_url[:80])

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        data = response.json()

    if response.status_code != 200:
        error_msg = data.get("message", "Unknown error")
        logger.error("Garment parsing failed: %s", error_msg)
        raise RuntimeError(f"Garment parsing failed: {error_msg}")

    return data.get("output", {})


def get_task_status(task_id: str) -> TryOnTask | None:
    """Get the current status of a try-on task."""
    return _tasks.get(task_id)


def cleanup_old_tasks(max_age: int = 3600) -> int:
    """Remove tasks older than max_age seconds."""
    now = time.time()
    to_remove = [tid for tid, t in _tasks.items() if now - t.created_at > max_age]
    for tid in to_remove:
        del _tasks[tid]
    return len(to_remove)



# ============================================================
# Background Swap Service
# ============================================================

BACKGROUNDS_DIR = Path(__file__).resolve().parent.parent / "assets" / "backgrounds"
BACKGROUNDS: dict[str, str] = {
    "white_minimal": "bg_white_minimal.png",
    "luxury_grey": "bg_luxury_grey.png",
    "warm_wood": "bg_warm_wood.png",
    "dark_drama": "bg_dark_drama.png",
    "urban_outdoor": "bg_urban_outdoor.png",
    "velvet_curtain": "bg_velvet_curtain.png",
}


def list_backgrounds() -> list[dict]:
    """Return available background templates with metadata."""
    result = []
    for bg_id, filename in BACKGROUNDS.items():
        path = BACKGROUNDS_DIR / filename
        exists = path.exists()
        label_map = {
            "white_minimal": "极简白",
            "luxury_grey": "轻奢灰",
            "warm_wood": "暖木调",
            "dark_drama": "暗调高级",
            "urban_outdoor": "都市户外",
            "velvet_curtain": "丝绒帘",
        }
        result.append({
            "id": bg_id,
            "name": label_map.get(bg_id, bg_id),
            "filename": filename,
            "available": exists,
        })
    return result


async def composite_with_background(
    person_image_bytes: bytes,
    background_id: str,
) -> bytes:
    """Composite a person image (with alpha) onto a background template.

    Applies post-processing for photorealistic results:
      1. Edge feathering (alpha blur) to remove cutout feel
      2. Drop shadow under the person's feet for grounding
      3. Color transfer (LAB histogram matching) to blend person into background
      4. White-balance shift to match background color temperature

    Args:
        person_image_bytes: PNG bytes of person with transparent background
                            (output from segment_body or DashScope result)
        background_id: Key from BACKGROUNDS dict

    Returns:
        JPEG bytes of the composited image
    """
    import io

    if background_id not in BACKGROUNDS:
        raise ValueError(f"Unknown background: {background_id}. Available: {list(BACKGROUNDS.keys())}")

    bg_path = BACKGROUNDS_DIR / BACKGROUNDS[background_id]
    if not bg_path.exists():
        raise FileNotFoundError(f"Background file not found: {bg_path}")

    # Load images
    person = Image.open(io.BytesIO(person_image_bytes)).convert("RGBA")
    bg = Image.open(bg_path).convert("RGBA")

    # Resize background to match person dimensions
    target_w, target_h = person.size
    bg_resized = bg.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # Scale person to fit background (leave some margin)
    scale_factor = (target_h * 0.88) / person.height
    new_w = int(person.width * scale_factor)
    new_h = int(person.height * scale_factor)
    person_scaled = person.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # --- Post-processing: enhance realism ---

    # 1) Edge feathering -- blur the alpha channel to soften hard edges
    r, g, b, a = person_scaled.split()
    a_feathered = a.filter(ImageFilter.GaussianBlur(radius=4))
    person_scaled = Image.merge("RGBA", (r, g, b, a_feathered))

    # 2) Color transfer -- match person colors to background (LAB histogram matching)
    person_scaled = _color_transfer_to_background(person_scaled, bg_resized)

    # 3) White-balance shift -- nudge person RGB toward background color temperature
    person_scaled = _white_balance_shift(person_scaled, bg_resized)

    # Position: centered horizontally, feet near bottom
    x_offset = (target_w - new_w) // 2
    y_offset = target_h - new_h - int(target_h * 0.02)  # 2% margin from bottom

    # 4) Drop shadow -- blurred dark ellipse under the person's feet
    result = bg_resized.copy()
    result = _add_drop_shadow(result, person_scaled, x_offset, y_offset)

    # Final composite
    result.paste(person_scaled, (x_offset, y_offset), person_scaled)

    # Convert to JPEG bytes
    output = io.BytesIO()
    result.convert("RGB").save(output, format="JPEG", quality=92)
    return output.getvalue()


def _srgb_to_lab(rgb_u8: np.ndarray) -> np.ndarray:
    """Convert uint8 RGB array to float64 LAB array. Vectorized, no PIL roundtrip."""
    arr = rgb_u8.astype(np.float64) / 255.0
    # sRGB linearize
    arr_lin = np.where(arr <= 0.04045, arr / 12.92, ((arr + 0.055) / 1.055) ** 2.4)
    # RGB -> XYZ (D65)
    M = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = arr_lin @ M.T
    # XYZ -> LAB
    ref = np.array([0.95047, 1.0, 1.08883])
    xyz_norm = xyz / ref
    epsilon = 0.008856
    kappa = 903.3
    f = np.where(xyz_norm > epsilon, np.cbrt(xyz_norm), (kappa * xyz_norm + 16) / 116)
    L = 116 * f[:, :, 1] - 16
    a_ch = 500 * (f[:, :, 0] - f[:, :, 1])
    b_ch = 200 * (f[:, :, 1] - f[:, :, 2])
    return np.stack([L, a_ch, b_ch], axis=-1)


def _lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    """Convert float64 LAB array back to uint8 RGB array."""
    ref = np.array([0.95047, 1.0, 1.08883])
    epsilon = 0.008856
    kappa = 903.3

    f_out = np.zeros_like(lab)
    f_out[:, :, 1] = (lab[:, :, 0] + 16) / 116
    f_out[:, :, 0] = lab[:, :, 1] / 500 + f_out[:, :, 1]
    f_out[:, :, 2] = f_out[:, :, 1] - lab[:, :, 2] / 200

    cond = f_out ** 3 > epsilon
    xyz_out = np.where(cond, ref * f_out ** 3, (116 * f_out - 16) * ref / kappa)

    M_inv = np.array([[ 3.2404542, -1.5371385, -0.4985314],
                      [-0.9692660,  1.8760108,  0.0415560],
                      [ 0.0556434, -0.2040259,  1.0572252]])
    rgb_lin = xyz_out @ M_inv.T
    rgb_out = np.where(rgb_lin <= 0.0031308,
                       12.92 * rgb_lin,
                       1.055 * np.power(np.clip(rgb_lin, 0, None), 1 / 2.4) - 0.055)
    return np.clip(rgb_out * 255, 0, 255).astype(np.uint8)


def _color_transfer_to_background(
    person_rgba: Image.Image,
    bg_rgba: Image.Image,
) -> Image.Image:
    """Match person's color distribution to background using LAB histogram matching.

    Only modifies pixels where alpha > 0 (the person).
    Strength is 40% to avoid over-shifting.
    """
    import numpy as np

    person_arr = np.array(person_rgba).astype(np.float64)
    alpha = person_arr[:, :, 3:4] / 255.0
    person_rgb = person_arr[:, :, :3]

    if alpha.max() < 0.05:
        return person_rgba

    bg_arr = np.array(bg_rgba.convert("RGB")).astype(np.float64)

    p_mask = alpha[:, :, 0] > 0.1
    if p_mask.sum() < 100:
        return person_rgba

    # Compute LAB statistics
    p_rgb_u8 = np.clip(person_rgb[p_mask], 0, 255).astype(np.uint8)
    p_lab = _srgb_to_lab(p_rgb_u8.reshape(1, -1, 3))
    p_mean = p_lab.mean(axis=(0, 1))
    p_std = p_lab.std(axis=(0, 1))

    bg_rgb_u8 = np.clip(bg_arr, 0, 255).astype(np.uint8)
    bg_lab = _srgb_to_lab(bg_rgb_u8)
    bg_mean = bg_lab.mean(axis=(0, 1))
    bg_std = bg_lab.std(axis=(0, 1))

    # Transfer in LAB space with 40% strength
    strength = 0.40
    std_ratio = np.where(p_std > 1, bg_std / p_std, 1.0)

    full_lab = _srgb_to_lab(np.clip(person_rgb, 0, 255).astype(np.uint8))
    transferred = (full_lab - p_mean) * std_ratio + bg_mean
    blended = full_lab * (1 - strength) + transferred * strength

    # LAB -> RGB
    rgb_out = _lab_to_srgb(blended).astype(np.float64)

    # Blend with original using alpha mask
    result_rgb = person_rgb * (1 - alpha) + rgb_out * alpha
    result_arr = np.concatenate([
        np.clip(result_rgb, 0, 255).astype(np.uint8),
        person_arr[:, :, 3:4].astype(np.uint8)
    ], axis=-1)
    return Image.fromarray(result_arr, "RGBA")


def _white_balance_shift(
    person_rgba: Image.Image,
    bg_rgba: Image.Image,
    strength: float = 0.15,
) -> Image.Image:
    """Shift person's white balance toward background color temperature.

    Analyzes average R/B ratio difference and applies a subtle correction.
    """
    import numpy as np

    person_arr = np.array(person_rgba).astype(np.float64)
    alpha = person_arr[:, :, 3:4] / 255.0
    if alpha.max() < 0.05:
        return person_rgba

    p_mask = alpha[:, :, 0] > 0.1
    if p_mask.sum() < 100:
        return person_rgba

    p_rgb = person_arr[:, :, :3]
    bg_rgb = np.array(bg_rgba.convert("RGB")).astype(np.float64)

    # Average color of person (masked) and background
    p_avg = p_rgb[p_mask].mean(axis=0)
    bg_avg = bg_rgb.mean(axis=(0, 1))

    # Compute R/G and B/G ratios for both
    p_rg = p_avg[0] / max(p_avg[1], 1)
    p_bg_ratio = p_avg[2] / max(p_avg[1], 1)
    bg_rg = bg_avg[0] / max(bg_avg[1], 1)
    bg_bg_ratio = bg_avg[2] / max(bg_avg[1], 1)

    # Correction factors
    r_factor = 1.0 + (bg_rg - p_rg) * strength
    b_factor = 1.0 + (bg_bg_ratio - p_bg_ratio) * strength
    r_factor = max(0.85, min(1.15, r_factor))
    b_factor = max(0.85, min(1.15, b_factor))

    # Apply to person pixels only
    corrected = p_rgb.copy()
    corrected[:, :, 0] *= r_factor
    corrected[:, :, 2] *= b_factor
    corrected = np.clip(corrected, 0, 255)

    result_arr = np.concatenate([
        corrected.astype(np.uint8),
        person_arr[:, :, 3:4].astype(np.uint8)
    ], axis=-1)
    return Image.fromarray(result_arr, "RGBA")


def _add_drop_shadow(
    canvas: Image.Image,
    person_rgba: Image.Image,
    x_offset: int,
    y_offset: int,
) -> Image.Image:
    """Add a soft drop shadow under the person's feet for grounding."""

    alpha = np.array(person_rgba.split()[3]).astype(np.float64) / 255.0
    h, w = alpha.shape

    # Find the bottom of the person (feet area)
    col_mask = alpha > 0.2
    foot_y = 0
    for row_idx in range(h - 1, max(h // 2, 0), -1):
        if col_mask[row_idx].sum() > w * 0.05:
            foot_y = row_idx
            break

    if foot_y == 0:
        return canvas

    # Find person's horizontal extent at foot level
    foot_cols = np.where(col_mask[foot_y])[0]
    if len(foot_cols) < 2:
        return canvas
    cx = x_offset + int((foot_cols[0] + foot_cols[-1]) / 2)
    shadow_w = int((foot_cols[-1] - foot_cols[0]) * 1.2)
    shadow_h = max(int(shadow_w * 0.12), 8)

    # Create shadow as a dark ellipse
    shadow = Image.new("RGBA", (shadow_w, shadow_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.ellipse([0, 0, shadow_w - 1, shadow_h - 1], fill=(0, 0, 0, 45))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(shadow_h // 3, 6)))

    # Paste shadow onto canvas (centered under feet)
    shadow_x = cx - shadow_w // 2
    shadow_y = y_offset + foot_y - shadow_h // 2 + int(shadow_h * 0.6)
    shadow_x = max(0, min(shadow_x, canvas.width - shadow_w))
    shadow_y = max(0, min(shadow_y, canvas.height - shadow_h))

    canvas.paste(shadow, (shadow_x, shadow_y), shadow)
    return canvas



async def swap_background(
    image_url: str,
    background_id: str,
) -> bytes:
    """Full pipeline: download image -> segment person -> composite with background.

    Args:
        image_url: URL of the try-on result image (from DashScope)
        background_id: Background template ID

    Returns:
        JPEG bytes of the final composited image
    """
    from app.services.aliyun_vision_service import download_image, AliyunVisionService

    # Step 1: Download the try-on result
    logger.info("Downloading image for background swap: %s", image_url[:80])
    image_bytes = await download_image(image_url)

    # Step 2: Segment person from background
    logger.info("Segmenting person from background...")
    vision = AliyunVisionService()
    person_bytes = await vision.segment_person(image_bytes)
    if not person_bytes or len(person_bytes) < 100:
        raise RuntimeError("Failed to segment person from image")

    # Step 3: Composite with new background
    logger.info("Compositing with background: %s", background_id)
    result_bytes = await composite_with_background(person_bytes, background_id)

    return result_bytes

