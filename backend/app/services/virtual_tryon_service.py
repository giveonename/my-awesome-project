"""Virtual Try-On service (qwen-image-3.0 via DashScope).

History: the aitryon model family (aitryon / aitryon-plus / aitryon-refiner /
aitryon-parsing-v1) was retired by Alibaba Cloud on 2026-10-10; the official
replacement is qwen-image-3.0 (multimodal-generation, sync call).

Key facts (verified 2026-10, official docs + live tests):
  - Endpoint: POST {base}/services/aigc/multimodal-generation/generation (sync)
  - Input: 1-3 reference images as public URL or base64 data URI + one text
  - Output: 2K image URL (expires in 24h -> always download and re-store)
  - Latency ~80-100s per generation; price ~0.18 CNY/image
  - Base64 input means try-on no longer depends on OSS public URLs
"""

import asyncio
import base64
import io
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from app.config import get_settings

logger = logging.getLogger(__name__)

# Official default person image from DashScope docs (fallback when no body photo)
DEFAULT_PERSON_URL = "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250626/ubznva/model_person.png"


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


def _is_top_type(item_type: str | None) -> bool:
    """Check if an item type is a top/upper garment."""
    return bool(item_type) and item_type.lower() in _TOP_TYPES


def _is_bottom_type(item_type: str | None) -> bool:
    """Check if an item type is a bottom/lower garment."""
    return bool(item_type) and item_type.lower() in _BOTTOM_TYPES


def _is_outfit_type(item_type: str | None) -> bool:
    """Check if an item type is a full outfit (avatar-sourced combo)."""
    return bool(item_type) and item_type.lower() in _OUTFIT_TYPES


def resolve_tryon_inputs(items: list[dict]) -> tuple[list[str], list[dict], bool]:
    """Resolve selected items into (garment_refs, descriptors, is_outfit).

    Each item dict should carry: ref (storage-relative path or URL), type,
    name, primary_color.
    - Any outfit-type item wins: its whole image is passed as ONE reference
      (no more parsing-v1 splitting — qwen handles whole outfits directly).
    - Otherwise pick one top + one bottom (max 2 garment references; the API
      accepts person + up to 2 garments).
    """
    if not items:
        return [], [], False

    outfits = [it for it in items if _is_outfit_type(it.get("type"))]
    if outfits:
        it = outfits[0]
        return [it.get("ref", "")], [it], True

    tops = [it for it in items if _is_top_type(it.get("type"))]
    bottoms = [it for it in items if _is_bottom_type(it.get("type"))]
    chosen: list[dict] = []
    if tops:
        chosen.append(tops[0])
    if bottoms:
        chosen.append(bottoms[0])
    if not chosen:
        chosen = [items[0]]
    return [c.get("ref", "") for c in chosen], chosen, False


def _describe_item(item: dict) -> str:
    """Build a short Chinese garment descriptor from item metadata."""
    name = (item.get("name") or "").strip()
    color = (item.get("primary_color") or "").strip()
    if not name:
        name = item.get("type") or "服装"
    if color and color not in name:
        name = f"{color}{name}"
    return name


def build_tryon_prompt(descs: list[dict], is_outfit: bool) -> str:
    """Build the qwen-image try-on prompt.

    Four-section structure validated by live A/B tests (2026-10):
    - explicit person-preservation + garment-fidelity + prohibitions
    - attribute claims come from real item metadata; length is left to the
      product image ("衣长比例") because a wrong length claim distorts output.
    """
    if is_outfit:
        cloth = (
            "图2是一整套搭配的服装图，请把图2中的整套搭配完整地穿到图1的人物身上，"
            "保持各件服装之间的搭配关系不变；严格保持每件服装的颜色、图案、文字与标识、"
            "面料纹理、款式版型以及衣长比例与图2完全一致。"
        )
    elif len(descs) >= 2:
        d1, d2 = _describe_item(descs[0]), _describe_item(descs[1])
        cloth = (
            f"图2是一件「{d1}」、图3是一件「{d2}」，请把这两件服装都穿到图1的人物身上，"
            "并保持两件服装之间的搭配关系；严格保持每件服装的颜色、图案、文字与标识、"
            "面料纹理、款式版型以及衣长比例与其商品图完全一致。"
        )
    else:
        d1 = _describe_item(descs[0]) if descs else "服装"
        cloth = (
            f"让图1中的人物穿上图2的服装：这是一件「{d1}」。"
            "严格保持该服装的颜色、图案、文字与标识、面料纹理、款式版型以及衣长比例"
            "与商品图完全一致。"
        )
    return (
        "你是一名专业的电商服装摄影师与修图师，请完成一张虚拟试穿照片：\n\n"
        "【保持人物】图1中人物的面部特征、发型、肤色、体型、姿势以及背景完全保持不变。\n"
        f"【穿着服装】{cloth}\n"
        "【成片要求】照片级真实感，服装自然贴合人体，褶皱与光影合理，人物比例协调，画面干净清晰。\n"
        "【禁止】不要改变人物长相与背景，不要添加图片中不存在的服装或道具，不要艺术化或卡通化处理。"
    )


# ===== qwen-image-3.0 generation =====


def _load_image_bytes(ref: str) -> bytes | None:
    """Load image bytes from storage-relative path, signed URL, or http(s) URL."""
    if not ref:
        return None
    settings = get_settings()
    storage = Path(settings.storage_path)

    if ref.startswith("http://") or ref.startswith("https://"):
        try:
            resp = httpx.get(ref, timeout=60, follow_redirects=True)
            if resp.status_code == 200 and resp.content:
                return resp.content
            logger.warning("Failed to download image ref %s: HTTP %d", ref[:80], resp.status_code)
        except Exception as e:
            logger.warning("Failed to download image ref %s: %s", ref[:80], e)
        return None

    path = ref
    if path.startswith("/api/v1/images/"):
        path = path[len("/api/v1/images/"):]
    path = path.split("?")[0]
    full = storage / path
    if full.exists():
        return full.read_bytes()
    logger.warning("Image file not found: %s", full)
    return None


def _prepare_image_b64(raw: bytes, max_dim: int, quality: int = 90) -> str:
    """Resize/convert to JPEG and return a data URI for the generation API."""
    img = Image.open(io.BytesIO(raw))
    if img.mode != "RGB":
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[3])
        img = bg
    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


_GENERATION_PATH = "/services/aigc/multimodal-generation/generation"


async def _call_qwen_generation(person_b64: str, garment_b64s: list[str], prompt: str) -> str:
    """Call qwen-image generation (sync). Returns the result image URL."""
    import json as _json

    settings = get_settings()
    url = f"{settings.dashscope_base_url}{_GENERATION_PATH}"
    content: list[dict] = [{"image": person_b64}]
    content.extend({"image": g} for g in garment_b64s)
    content.append({"text": prompt})
    payload = {
        "model": settings.dashscope_tryon_model,
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": {"watermark": False},
    }
    timeout = httpx.Timeout(settings.virtual_tryon_timeout, connect=15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=_get_headers())
    try:
        data = resp.json()
    except Exception:
        data = {}
    if resp.status_code != 200:
        msg = data.get("message") or _json.dumps(data, ensure_ascii=False)[:200]
        code = data.get("code", "")
        raise RuntimeError(f"{code}: {msg}" if code else str(msg))
    try:
        parts = data["output"]["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"Unexpected generation response: {str(data)[:200]}") from e
    image_url = next(
        (p.get("image") for p in parts if isinstance(p, dict) and p.get("image")), None
    )
    if not image_url:
        raise RuntimeError("Generation response contained no image")
    return image_url


async def _run_generation(
    person_ref: str,
    garment_refs: list[str],
    descs: list[dict],
    is_outfit: bool,
    user_id,
) -> str:
    """Load local images, generate the try-on image, store it, return its URL."""
    person_raw = await asyncio.to_thread(_load_image_bytes, person_ref)
    if not person_raw:
        raise RuntimeError("无法读取人物照片（请先上传全身照）")

    garment_b64s: list[str] = []
    for ref in garment_refs[:2]:
        raw = await asyncio.to_thread(_load_image_bytes, ref)
        if not raw:
            raise RuntimeError(f"无法读取衣物图片: {ref[:60]}")
        garment_b64s.append(await asyncio.to_thread(_prepare_image_b64, raw, 1400))
    if not garment_b64s:
        raise RuntimeError("没有可用的衣物图片")

    person_b64 = await asyncio.to_thread(_prepare_image_b64, person_raw, 1600)
    prompt = build_tryon_prompt(descs, is_outfit)

    result_url = await _call_qwen_generation(person_b64, garment_b64s, prompt)

    # Result URLs expire in 24h — download and re-store in our own storage.
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        img_resp = await client.get(result_url)
    if img_resp.status_code != 200 or len(img_resp.content) < 1000:
        raise RuntimeError(f"试穿结果下载失败 (HTTP {img_resp.status_code})")

    from app.services.image_service import ImageService
    from app.utils.signed_urls import sign_image_url

    image_service = ImageService()
    paths = await image_service.process_and_store(
        user_id=user_id,
        image_data=img_resp.content,
        original_filename="tryon_result.jpg",
    )
    return sign_image_url(paths["image_path"])


def _spawn_task(
    person_ref: str,
    garment_refs: list[str],
    descs: list[dict],
    is_outfit: bool,
    user_id,
) -> TryOnTask:
    """Create a task record and run the generation in the background."""
    task_id = uuid.uuid4().hex
    task = TryOnTask(
        task_id=task_id,
        status="RUNNING",
        model_used=get_settings().dashscope_tryon_model,
    )
    _tasks[task_id] = task

    async def _runner() -> None:
        try:
            image_url = await _run_generation(
                person_ref, garment_refs, descs, is_outfit, user_id
            )
            task.image_url = image_url
            task.status = "SUCCEEDED"
            logger.info("Try-on completed: task_id=%s", task_id)
        except Exception as e:
            task.status = "FAILED"
            task.error = str(e)[:300]
            logger.error("Try-on failed: task_id=%s, error=%s", task_id, e, exc_info=True)

    asyncio.create_task(_runner())
    return task


async def submit_tryon_task(
    person_ref: str,
    garment_refs: list[str],
    descs: list[dict] | None = None,
    is_outfit: bool = False,
    user_id=None,
) -> TryOnTask:
    """Submit a try-on task — returns task_id immediately, generation runs async."""
    settings = get_settings()
    if not settings.dashscope_api_key:
        return TryOnTask(task_id="", status="FAILED", error="DashScope API key not configured")
    logger.info(
        "Submitting try-on: model=%s, garments=%d, outfit=%s",
        settings.dashscope_tryon_model, len(garment_refs), is_outfit,
    )
    return _spawn_task(person_ref, garment_refs, descs or [], is_outfit, user_id)


async def check_task_once(task_id: str) -> TryOnTask | None:
    """Single non-blocking check of the local try-on task state."""
    return _tasks.get(task_id)


async def virtual_tryon(
    person_ref: str,
    garment_refs: list[str],
    descs: list[dict] | None = None,
    is_outfit: bool = False,
    user_id=None,
) -> TryOnResult:
    """Synchronous try-on: generate and return the stored result URL (~80-100s)."""
    settings = get_settings()
    start_time = time.time()
    if not settings.dashscope_api_key:
        return TryOnResult(success=False, error="DashScope API key not configured")
    try:
        image_url = await _run_generation(
            person_ref, garment_refs, descs or [], is_outfit, user_id
        )
    except Exception as e:
        logger.error("Virtual try-on failed: %s", e, exc_info=True)
        return TryOnResult(
            success=False,
            model_used=settings.dashscope_tryon_model,
            error=str(e)[:300],
            elapsed_seconds=time.time() - start_time,
        )
    elapsed = time.time() - start_time
    logger.info("Virtual try-on completed in %.1fs", elapsed)
    return TryOnResult(
        success=True,
        image_url=image_url,
        model_used=settings.dashscope_tryon_model,
        elapsed_seconds=elapsed,
    )


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

