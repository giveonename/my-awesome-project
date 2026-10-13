"""Product recommendation API endpoints."""

import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.body_profile import BodyProfile
from app.models.item import ClothingItem
from app.models.user import User
from app.models.preference import UserPreference
from app.models.learning import UserLearningProfile
from uuid import UUID
from app.services.taobao_service import search_products
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/products", tags=["Products"])


# ===== Schemas =====

class ProductResponse(BaseModel):
    title: str
    pic_url: str
    price: str
    original_price: str
    volume: str
    shop_title: str
    item_url: str
    category_name: str
    related_items: list[dict] = Field(default_factory=list)


class WardrobeGap(BaseModel):
    category: str
    label: str
    reason: str
    count: int
    keyword: str


class ProductRecommendResponse(BaseModel):
    products: list[ProductResponse]
    gap: WardrobeGap | None = None
    total: int
    page: int
    has_more: bool
    keyword_used: str = ""
    reason: str = ""


class CompleteOutfitRequest(BaseModel):
    item_ids: list[str] = Field(..., min_length=1, max_length=5, description="已选衣物 ID 列表")
    target_category: str = Field("", description="想找的品类（空=自动检测缺失品类）")


class CategoryProducts(BaseModel):
    category: str
    label: str
    reason: str
    products: list[ProductResponse]


class CompleteOutfitResponse(BaseModel):
    groups: list[CategoryProducts]
    selected_items: list[dict]
    keyword_used: str = ""


class WardrobeGapListResponse(BaseModel):
    gaps: list[WardrobeGap]
    total_items: int


# ===== Category mapping =====

CATEGORY_MAP = {
    "top": {"types": ["shirt", "t-shirt", "sweater", "hoodie", "blazer", "jacket", "coat", "top"], "label": "上衣", "keywords": ["T恤", "衬衫", "卫衣", "毛衣"]},
    "bottom": {"types": ["pants", "jeans", "shorts", "skirt"], "label": "下装", "keywords": ["裤子", "牛仔裤", "短裤", "裙子"]},
    "dress": {"types": ["dress"], "label": "连衣裙", "keywords": ["连衣裙"]},
    "shoes": {"types": ["shoes", "sneakers", "boots"], "label": "鞋子", "keywords": ["运动鞋", "板鞋", "靴子", "小白鞋"]},
    "outerwear": {"types": ["jacket", "coat", "blazer"], "label": "外套", "keywords": ["薄外套", "针织开衫", "夹克"]},
    "accessories": {"types": ["accessories", "hat", "bag", "scarf", "belt"], "label": "配饰", "keywords": ["女包", "帽子", "围巾"]},
}

# Category keyword -> which wardrobe categories complement it
CATEGORY_COMPLEMENT = {
    "top": ["bottom", "dress", "shoes", "accessories"],
    "bottom": ["top", "outerwear", "shoes"],
    "dress": ["shoes", "accessories", "outerwear"],
    "shoes": ["bottom", "dress", "top"],
    "outerwear": ["top", "bottom"],
    "accessories": ["top", "dress"],
}

# Color harmony groups — colors that go well together
# Neutral colors pair with almost everything
NEUTRAL_COLORS = {"black", "white", "gray", "grey", "beige", "navy", "cream", "khaki", "brown"}

# Color complement pairs (classic fashion rules)
COLOR_COMPLEMENTS: dict[str, set[str]] = {
    "black": {"white", "red", "gold", "silver", "pink", "beige", "cream"},
    "white": {"black", "navy", "red", "blue", "green", "brown", "pink", "gray"},
    "navy": {"white", "cream", "beige", "gold", "pink", "light-blue"},
    "blue": {"white", "cream", "brown", "gray", "orange"},
    "red": {"black", "white", "gray", "navy", "denim-blue"},
    "brown": {"white", "cream", "beige", "navy", "olive", "tan"},
    "gray": {"white", "black", "pink", "blue", "red", "yellow"},
    "grey": {"white", "black", "pink", "blue", "red", "yellow"},
    "green": {"white", "cream", "brown", "beige", "navy"},
    "olive": {"white", "cream", "brown", "beige", "black"},
    "pink": {"white", "gray", "navy", "black", "denim-blue"},
    "beige": {"black", "navy", "brown", "white", "olive"},
    "cream": {"brown", "navy", "black", "olive"},
    "denim-blue": {"white", "black", "red", "gray", "brown"},
}


# ===== Style label mapping =====
STYLE_LABELS: dict[str, str] = {
    "casual": "休闲",
    "minimalist": "简约",
    "elegant": "优雅",
    "street": "街头",
    "sporty": "运动",
    "korean": "韩系",
    "japanese": "日系",
    "french": "法式",
    "retro": "复古",
    "sweet": "甜美",
    "mature": "知性",
    "preppy": "学院",
    "bohemian": "波西米亚",
    # 前端「风格偏好」的标签 key 里还有这几个，缺了会被静默忽略
    "office": "通勤",
    "artistic": "文艺",
    "streetwear": "潮流",
    "bold": "大胆",
}

COLOR_LABELS: dict[str, str] = {
    "black": "黑色", "white": "白色", "gray": "灰色", "grey": "灰色",
    "beige": "米色", "navy": "藏蓝", "cream": "奶油色", "khaki": "卡其色",
    "brown": "棕色", "red": "红色", "blue": "蓝色", "green": "绿色",
    "pink": "粉色", "orange": "橙色", "yellow": "黄色", "purple": "紫色",
    "olive": "橄榄绿", "tan": "棕褐色", "denim-blue": "牛仔蓝",
    "light-blue": "浅蓝", "gold": "金色", "silver": "银色",
}

SCENE_KEYWORDS: dict[str, str] = {
    "commute": "通勤",
    "date": "约会",
    "casual": "日常",
    "sport": "运动",
    "party": "宴会",
    "travel": "旅行",
}

# Gender-aware keyword dictionaries
# neutral = fallback when gender is unknown or "prefer-not-to-say"
_GENDER_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "shoes": {
        "male": ["运动鞋", "休闲鞋", "皮鞋", "帆布鞋", "板鞋"],
        "female": ["平底鞋", "小白鞋", "运动鞋", "乐福鞋", "短靴", "凉鞋"],
        "neutral": ["运动鞋", "小白鞋", "休闲鞋", "帆布鞋"],
    },
    "accessories": {
        "male": ["公文包", "双肩包", "腰带", "手表"],
        "female": ["斜挎包", "手提包", "丝巾", "耳环"],
        "neutral": ["背包", "腰带", "围巾", "帽子"],
    },
    "bottom": {
        "male": ["西裤", "牛仔裤", "休闲裤", "短裤"],
        "female": ["阔腿裤", "半身裙", "牛仔裤", "百褶裙"],
        "neutral": ["牛仔裤", "休闲裤", "阔腿裤", "西裤"],
    },
    "top": {
        "male": ["衬衫", "T恤", "POLO衫", "卫衣"],
        "female": ["衬衫", "针织衫", "T恤", "雪纺衫"],
        "neutral": ["衬衫", "T恤", "针织衫", "卫衣"],
    },
    "outerwear": {
        "male": ["西装外套", "夹克", "风衣", "棒球服"],
        "female": ["风衣", "针织开衫", "西装外套", "薄外套"],
        "neutral": ["风衣", "薄外套", "夹克", "西装外套"],
    },
    "dress": {
        "male": ["连体裤"],  # rare but exists
        "female": ["连衣裙", "法式连衣裙", "碎花裙", "气质连衣裙"],
        "neutral": ["连衣裙", "套装"],
    },
}


def _get_gender_key(gender: str | None) -> str:
    """Map user gender to keyword dictionary key."""
    if gender == "male":
        return "male"
    if gender == "female":
        return "female"
    return "neutral"


async def _get_user_profile(db: AsyncSession, user_id) -> tuple:
    """Fetch user preference and learning profile."""
    pref_result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    )
    pref = pref_result.scalar_one_or_none()

    learning_result = await db.execute(
        select(UserLearningProfile).where(UserLearningProfile.user_id == user_id)
    )
    learning = learning_result.scalar_one_or_none()
    return pref, learning


# 体型词表是女装语境（模板遗留），只对女性用户生效；男性用户用身高/体重推导
_BODY_TYPE_HINTS = {
    "hourglass": "修身",
    "pear": "A字",
    "apple": "高腰",
    "rectangle": "直筒",
    "inverted-triangle": "落肩",
}

# 结果质量闸门：与画像矛盾的品类/人群直接剔除
_ALWAYS_BLOCK = (
    "童装", "儿童", "宝宝", "婴儿", "幼儿", "中大童", "亲子装",
    "中老年", "老年装", "老人", "妈妈装",
)
_FEMALE_MARKERS = (
    "女装", "女士", "女款", "女式", "女生", "连衣裙", "半身裙",
    "文胸", "内衣", "丝袜", "高跟鞋", "孕妇装",
)
_MALE_MARKERS = ("男装", "男士", "男款", "男式", "男生", "爸爸装")
_NEUTRAL_MARKERS = ("中性", "情侣", "男女", "同款", "通用")

# 版型翻译：身高 → 长度偏好，BMI → 松紧偏好
_FIT_HINT_CAP = 2


def _fit_hints(
    height_cm: float | None, weight_kg: float | None, body_type: str | None, gender: str | None
) -> list[str]:
    """身高/体重/体型 → 商品搜索的版型限定词（最多 2 个）。"""
    hints: list[str] = []
    if height_cm:
        if height_cm >= 178:
            hints.append("加长")
        elif height_cm <= 165:
            hints.append("九分")
    if height_cm and weight_kg:
        bmi = weight_kg / ((height_cm / 100) ** 2)
        if bmi < 18.5:
            hints.append("修身")
        elif bmi >= 24:
            hints.append("宽松")
    if (gender or "").lower().startswith("f") and body_type:
        hint = _BODY_TYPE_HINTS.get(body_type)
        if hint:
            hints.append(hint)
    return hints[:_FIT_HINT_CAP]


async def _load_fit_context(db: AsyncSession, user_id) -> tuple[list[str], str | None]:
    """从身材数据推导版型限定词；返回 (hints, gender)。"""
    profile = (
        await db.execute(select(BodyProfile).where(BodyProfile.user_id == user_id))
    ).scalar_one_or_none()
    pref = (
        await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
    ).scalar_one_or_none()
    gender = pref.gender if pref else None

    hints: list[str] = []
    if profile:
        hints = _fit_hints(
            profile.height_cm, profile.weight_kg, profile.body_type, gender
        )
    return hints, gender


async def _personalize_keyword(
    db: AsyncSession, user_id, keyword: str, reason: str
) -> tuple[str, str, str | None]:
    """把性别前缀 + 版型限定词接进搜索词，并把适配说明写进推荐理由。"""
    hints, gender = await _load_fit_context(db, user_id)
    parts: list[str] = []
    keyword = keyword or ""
    if gender:
        g = gender.lower()
        has_gender_word = any(
            k in keyword for k in ("男", "女", "中性", "情侣", "男女")
        )
        if not has_gender_word:
            parts.append("男士" if g.startswith("m") else "女士")
    parts.extend(hints)
    if parts:
        joined = " ".join(parts)
        keyword = f"{keyword} {joined}".strip()
        note = f"关键词适配「{joined}」"
        reason = f"{reason} · {note}" if reason else note
    return keyword, reason, gender


def _profile_product_ok(title: str, category: str, gender: str | None) -> bool:
    """标题/类目是否与用户画像矛盾。"""
    text = f"{title} {category}".lower()
    if any(k in text for k in _ALWAYS_BLOCK):
        return False
    if not gender:
        return True
    has_neutral = any(k in text for k in _NEUTRAL_MARKERS)
    if gender.lower().startswith("m"):
        if has_neutral or any(k in text for k in _MALE_MARKERS):
            return True
        return not any(k in text for k in _FEMALE_MARKERS)
    if gender.lower().startswith("f"):
        if has_neutral or any(k in text for k in _FEMALE_MARKERS):
            return True
        return not any(k in text for k in _MALE_MARKERS)
    return True


def _apply_profile_gate(products: list, gender: str | None) -> list:
    """剔除与画像矛盾的商品。

    严格过滤后数量过少时，先用"没有性别标记"的中性商品补位，
    最后才退到"只剔童装/中老年"的软过滤——避免把明确矛盾的商品又放回来。
    """
    if not gender or not products:
        return products

    def text_of(p) -> str:
        return f"{p.title or ''} {getattr(p, 'category_name', '') or ''}".lower()

    kept = [p for p in products if _profile_product_ok(p.title or "", getattr(p, "category_name", "") or "", gender)]
    if len(kept) >= 4 or len(products) <= 4:
        return kept

    g = gender.lower()
    opposite = _FEMALE_MARKERS if g.startswith("m") else _MALE_MARKERS
    unknown = [
        p
        for p in products
        if p not in kept
        and not any(k in text_of(p) for k in opposite)
        and not any(k in text_of(p) for k in _ALWAYS_BLOCK)
    ]
    combined = kept + unknown
    if len(combined) >= 3:
        logger.info("Profile gate: kept %d strict + %d neutral", len(kept), len(unknown))
        return combined

    soft = [p for p in products if not any(k in text_of(p) for k in _ALWAYS_BLOCK)]
    logger.info("Profile gate relaxed: %d strict -> %d soft", len(kept), len(soft))
    return soft or products


def _get_user_style(pref, learning) -> str:
    """Extract user style from preferences and learning profile."""
    # Try learned styles first (higher confidence)
    if learning and learning.learned_style_scores:
        best_style = max(learning.learned_style_scores, key=learning.learned_style_scores.get)
        if learning.learned_style_scores[best_style] > 0.3 and best_style in STYLE_LABELS:
            return STYLE_LABELS[best_style]
    # Fallback to explicit preferences
    if pref and pref.style_identity:
        for sid in pref.style_identity:
            if sid in STYLE_LABELS:
                return STYLE_LABELS[sid]
    return ""


def _get_user_color(pref, learning) -> str:
    """Extract user color preference, avoiding disliked colors."""
    avoid = set(pref.color_avoid) if pref and pref.color_avoid else set()
    # Try learned color scores
    if learning and learning.learned_color_scores:
        scored = {c: s for c, s in learning.learned_color_scores.items() if s > 0 and c not in avoid}
        if scored:
            return max(scored, key=scored.get)
    # Fallback to explicit favorites
    if pref and pref.color_favorites:
        for c in pref.color_favorites:
            if c not in avoid:
                return c
    return ""


def _dedup_products_against_wardrobe(products: list, wardrobe_items: list, target_cat: str) -> list:
    """Filter out products too similar to what user already owns.

    Removes products that match an existing wardrobe item's category + color.
    """
    if not wardrobe_items or not target_cat:
        return products

    # Build set of (category, color) pairs user already has
    owned = set()
    for item in wardrobe_items:
        item_cat = ""
        for cat_key, cat_info in CATEGORY_MAP.items():
            if (item.type or "").lower() in cat_info["types"]:
                item_cat = cat_key
                break
        if item_cat:
            color = (item.primary_color or "").lower()
            if color:
                owned.add((item_cat, color))

    # For each product, check if it overlaps too much with owned items
    filtered = []
    for p in products:
        title_lower = (p.title or "").lower()
        # Try to detect product color from title
        product_colors = set()
        for color_key, color_cn in COLOR_LABELS.items():
            if color_cn in title_lower or color_key in title_lower:
                product_colors.add(color_key)

        # If product has a color that matches an owned item in the same category
        is_dup = False
        for color in product_colors:
            if (target_cat, color) in owned:
                is_dup = True
                break

        if not is_dup:
            filtered.append(p)

    # Don't over-filter: keep at least 3 products
    if len(filtered) < 3:
        return products
    return filtered


async def _build_smart_keyword(
    db: AsyncSession,
    user_id,
    gap_category: str | None = None,
    item_id: UUID | None = None,
    scene: str | None = None,
) -> tuple[str, str, str]:
    """Generate a personalized search keyword for product recommendation.

    Returns (keyword, reason) where reason explains why this keyword was chosen.

    Three modes:
    1. Based on a specific item (item_id) -> find complementary products
    2. Based on wardrobe gap (gap_category) -> fill missing categories
    3. Based on scene (scene) -> scene-appropriate products
    """
    pref, learning = await _get_user_profile(db, user_id)

    # Extract user style and color preferences
    user_style = _get_user_style(pref, learning)
    user_color = _get_user_color(pref, learning)
    user_gender = pref.gender if pref else None

    # --- Mode 1: Based on a specific item ---
    if item_id:
        item_result = await db.execute(
            select(ClothingItem).where(
                ClothingItem.id == item_id,
                ClothingItem.user_id == user_id,
            )
        )
        item = item_result.scalar_one_or_none()
        if item:
            item_type = (item.type or "").lower()
            item_color = item.primary_color or ""
            item_style = ""
            if item.style:
                for s in item.style:
                    if s in STYLE_LABELS:
                        item_style = STYLE_LABELS[s]
                        break

            # Find complementary categories
            complement_cats = CATEGORY_COMPLEMENT.get(item_type, [])
            if not complement_cats:
                # If item type not in map, try to infer from type first
                for cat_key, cat_info in CATEGORY_MAP.items():
                    if item_type in cat_info["types"]:
                        complement_cats = CATEGORY_COMPLEMENT.get(cat_key, [])
                        break
            if not complement_cats:
                # Infer from name/description text (for "outfit" type items)
                infer_text = (item.name or "") + " " + (item.ai_description or "")
                INFER_KEYWORDS = {
                    "top": ["上衣", "衬衫", "T恤", "卫衣", "毛衣", "西装外套", "夹克", "背心", "polo", "针织"],
                    "bottom": ["裤子", "牛仔裤", "短裤", "裙子", "半裙", "阔腿裤", "西裤", "裤"],
                    "dress": ["连衣裙", "套装裙", "长裙"],
                    "shoes": ["鞋", "靴", "拖鞋", "凉鞋", "板鞋", "运动鞋"],
                    "outerwear": ["外套", "风衣", "大衣", "开衫", "棉服", "羽绒"],
                    "accessories": ["包", "帽", "围巾", "腰带", "项链", "耳环", "手链"],
                }
                for cat_key, keywords in INFER_KEYWORDS.items():
                    if any(kw in infer_text for kw in keywords):
                        complement_cats = CATEGORY_COMPLEMENT.get(cat_key, [])
                        item_type = cat_key  # Update for color/style use below
                        break

            if complement_cats:
                target_cat = complement_cats[0]
            else:
                target_cat = "bottom"

            # Smart keyword: pick precise complementary terms based on item features
            target_keyword = _pick_complement_keyword(
                item, target_cat, item_style or user_style, user_gender
            )

            # Color harmony: prefer complementary colors over same color
            color_part = _pick_pairing_color(item_color, target_cat, user_color)
            style_part = item_style or user_style

            parts = [p for p in [style_part, color_part, target_keyword] if p]
            keyword = " ".join(parts)
            item_label = item.name or item.type or "衣物"
            reason = f"与你的{item_label}搭配"
            return keyword, reason, target_cat

    # --- Mode 2: Scene-based recommendation ---
    if scene:
        scene_kw = SCENE_KEYWORDS.get(scene, scene)
        # Pick a gap category or default to "bottom"
        target_keyword = "服装"
        target_cat = gap_category or ''
        if gap_category:
            cat_info = CATEGORY_MAP.get(gap_category, {})
            target_keyword = cat_info.get("keywords", ["服装"])[0]
        else:
            # Auto-detect a gap
            gaps = await _analyze_wardrobe_gaps(db, user_id)
            if gaps:
                # Pick randomly from top-priority gaps for variety
                top_count = gaps[0].count
                top_gaps = [g for g in gaps if g.count == top_count]
                chosen = random.choice(top_gaps)
                target_cat = chosen.category
                gk = _get_gender_key(user_gender)
                _SCENE_SMART_KEYWORDS = {
                    cat: _GENDER_KEYWORDS.get(cat, {}).get(gk, ["服装"])
                    for cat in ["bottom", "top", "shoes", "outerwear", "dress", "accessories"]
                }
                cat_kws = _SCENE_SMART_KEYWORDS.get(target_cat, ["服装"])
                target_keyword = random.choice(cat_kws)

        parts = [p for p in [scene_kw, user_style, target_keyword] if p]
        keyword = " ".join(parts)
        reason = f"{scene_kw}\u573a\u666f\u63a8\u8350"
        return keyword, reason, target_cat

    # --- Mode 3: Gap-based (default) ---
    target_cat = gap_category or ''
    target_keyword = "T恤"
    if gap_category:
        cat_info = CATEGORY_MAP.get(gap_category, {})
        target_keyword = cat_info.get("keywords", ["T恤"])[0]
    else:
        gaps = await _analyze_wardrobe_gaps(db, user_id)
        if gaps:
            # Pick randomly from top-priority gaps for variety on each visit
            top_count = gaps[0].count
            top_gaps = [g for g in gaps if g.count == top_count]
            chosen = random.choice(top_gaps)
            target_cat = chosen.category
            gk = _get_gender_key(user_gender)
            _GAP_SMART_KEYWORDS = {
                cat: _GENDER_KEYWORDS.get(cat, {}).get(gk, ["服装"])
                for cat in ["bottom", "top", "shoes", "outerwear", "dress", "accessories"]
            }
            cat_kws = _GAP_SMART_KEYWORDS.get(target_cat, [chosen.keyword])
            target_keyword = random.choice(cat_kws)
        else:
            target_keyword = "服装"
    color_part = COLOR_LABELS.get(user_color, user_color)
    style_part = user_style
    parts = [p for p in [style_part, color_part, target_keyword] if p]
    keyword = " ".join(parts)
    reason = f"\u8865\u5168\u4f60\u7684\u8863\u6a71\u7f3a\u53e3"
    return keyword, reason, target_cat



def _pick_complement_keyword(item, target_cat: str, style_hint: str = "", gender: str | None = None) -> str:
    """Pick a precise search keyword for the complementary category based on item features.

    Instead of generic "裤子", returns specific terms like "西裤", "阔腿裤" based on
    the item's style, name, material, and occasion. Gender-aware.
    """
    item_name = (item.name or "").lower()
    item_desc = (item.ai_description or "").lower()
    item_text = item_name + " " + item_desc
    item_tags = item.tags if isinstance(item.tags, dict) else {}
    item_material = (item.material or "").lower()
    item_formality = item_tags.get("fit", "")

    # Formality detection
    is_formal = any(w in item_text for w in ["西装", "西服", "正装", "商务", "职业", "羊毛", "毛呢"]) \
        or item_material in ["wool", "silk", "cashmere"] \
        or item_formality == "tailored"
    is_casual = any(w in item_text for w in ["休闲", "运动", "卫衣", "t恤", "牛仔", "棉"])
    is_elegant = any(w in item_text for w in ["优雅", "气质", "法式", "精致"]) \
        or style_hint in ["elegant", "french"]

    gk = _get_gender_key(gender)

    # Gender-aware keyword candidates per complementary category
    _PRECISE_KEYWORDS = {
        "bottom": {
            "male": {
                "formal": ["西裤", "西装裤", "直筒裤"],
                "elegant": ["休闲西裤", "高腰裤"],
                "casual": ["牛仔裤", "休闲裤", "运动裤"],
                "default": ["裤子", "休闲裤"],
            },
            "female": {
                "formal": ["西裤", "西装裤", "直筒裤", "高腰裤"],
                "elegant": ["阔腿裤", "半身裙", "高腰裤", "百褶裙"],
                "casual": ["牛仔裤", "休闲裤", "运动裤"],
                "default": ["裤子", "阔腿裤"],
            },
            "neutral": {
                "formal": ["西裤", "直筒裤"],
                "elegant": ["阔腿裤", "高腰裤"],
                "casual": ["牛仔裤", "休闲裤"],
                "default": ["裤子", "休闲裤"],
            },
        },
        "top": {
            "male": {
                "formal": ["衬衫", "POLO衫", "打底衫"],
                "elegant": ["针织衫", "衬衫"],
                "casual": ["T恤", "卫衣", "POLO衫"],
                "default": ["上衣", "衬衫"],
            },
            "female": {
                "formal": ["衬衫", "雪纺衫", "打底衫"],
                "elegant": ["针织衫", "雪纺衫", "蕾丝衫"],
                "casual": ["T恤", "卫衣"],
                "default": ["上衣", "衬衫"],
            },
            "neutral": {
                "formal": ["衬衫", "打底衫"],
                "elegant": ["针织衫", "衬衫"],
                "casual": ["T恤", "卫衣"],
                "default": ["上衣", "衬衫"],
            },
        },
        "shoes": {
            "male": {
                "formal": ["皮鞋", "尖头鞋"],
                "elegant": ["皮鞋", "乐福鞋"],
                "casual": ["运动鞋", "板鞋", "帆布鞋"],
                "default": ["鞋子", "运动鞋"],
            },
            "female": {
                "formal": ["高跟鞋", "尖头鞋", "皮鞋"],
                "elegant": ["高跟鞋", "玛丽珍鞋", "尖头鞋"],
                "casual": ["运动鞋", "板鞋", "帆布鞋"],
                "default": ["鞋子", "单鞋"],
            },
            "neutral": {
                "formal": ["皮鞋"],
                "elegant": ["单鞋"],
                "casual": ["运动鞋", "板鞋"],
                "default": ["鞋子", "运动鞋"],
            },
        },
        "outerwear": {
            "male": {
                "formal": ["西装外套", "风衣", "大衣"],
                "elegant": ["风衣", "薄外套"],
                "casual": ["夹克", "棒球服", "卫衣外套"],
                "default": ["外套", "夹克"],
            },
            "female": {
                "formal": ["西装外套", "风衣", "大衣"],
                "elegant": ["针织开衫", "薄外套", "风衣"],
                "casual": ["夹克", "棒球服", "卫衣外套"],
                "default": ["外套", "薄外套"],
            },
            "neutral": {
                "formal": ["西装外套", "风衣"],
                "elegant": ["薄外套", "风衣"],
                "casual": ["夹克", "卫衣外套"],
                "default": ["外套", "薄外套"],
            },
        },
        "dress": {
            "male": {
                "formal": ["连体裤"],
                "elegant": ["连体裤"],
                "casual": ["连体裤"],
                "default": ["连体裤"],
            },
            "female": {
                "formal": ["连衣裙", "职业裙"],
                "elegant": ["法式连衣裙", "碎花裙", "气质连衣裙"],
                "casual": ["连衣裙", "T恤裙"],
                "default": ["连衣裙"],
            },
            "neutral": {
                "formal": ["连衣裙"],
                "elegant": ["连衣裙"],
                "casual": ["连衣裙"],
                "default": ["连衣裙"],
            },
        },
        "accessories": {
            "male": {
                "formal": ["公文包", "腰带", "手表"],
                "elegant": ["皮带", "手表"],
                "casual": ["双肩包", "棒球帽", "运动包"],
                "default": ["背包", "腰带"],
            },
            "female": {
                "formal": ["手提包", "公文包", "丝巾"],
                "elegant": ["斜挎包", "珍珠项链", "丝巾"],
                "casual": ["帆布包", "棒球帽", "运动包"],
                "default": ["斜挎包", "围巾"],
            },
            "neutral": {
                "formal": ["公文包", "腰带"],
                "elegant": ["斜挎包", "围巾"],
                "casual": ["背包", "帽子"],
                "default": ["背包", "腰带"],
            },
        },
    }

    cat_keywords = _PRECISE_KEYWORDS.get(target_cat, _PRECISE_KEYWORDS.get("bottom"))
    gender_kws = cat_keywords.get(gk, cat_keywords.get("neutral"))

    if is_formal:
        candidates = gender_kws.get("formal", gender_kws["default"])
    elif is_elegant:
        candidates = gender_kws.get("elegant", gender_kws["default"])
    elif is_casual:
        candidates = gender_kws.get("casual", gender_kws["default"])
    else:
        candidates = gender_kws["default"]

    return candidates[0]


def _pick_pairing_color(item_color: str, target_cat: str, user_pref_color: str = "") -> str:
    """Pick a harmonious color for the complementary item.

    Fashion rules:
    - Neutral tops -> prefer dark neutrals
    - Warm-colored tops -> white/cream/beige bottoms
    - Cool-colored tops -> black/navy/denim bottoms
    """

    ic = (item_color or "").lower()
    neutral_colors = {"black", "white", "gray", "grey", "beige", "navy", "cream", "khaki", "brown"}
    warm_colors = {"red", "pink", "orange", "coral", "burgundy", "wine", "rose"}
    cool_colors = {"blue", "green", "purple", "teal", "mint", "lavender"}

    if target_cat in ("bottom", "shoes"):
        if ic in ("gray", "grey"):
            return "黑色"
        if ic in ("black", "navy"):
            return ""  # dark top -> any bottom
        if ic in ("white", "cream"):
            return "藏蓝"  # white + navy is classic, more variety than all-black
        if ic in warm_colors:
            return ""  # warm top -> many options, don't restrict
        if ic in cool_colors:
            return "白色"  # cool top + white bottom is fresh
        if ic in neutral_colors:
            return ""  # neutral top -> don't restrict
        return ""  # unknown color -> don't restrict

    if target_cat == "top":
        if ic in neutral_colors:
            return ""
        return "白色"

    return ""


def _match_score(item: ClothingItem, product_category: str) -> float:
    """Score how well a wardrobe item complements a product category.

    Higher = better match for picture-in-picture display.
    """
    score = 0.0
    item_type = (item.type or "").lower()

    # Category complementarity (core rule)
    comp_cats = CATEGORY_COMPLEMENT.get(product_category, [])
    item_in_complement = False
    for cat_key in comp_cats:
        if item_type in CATEGORY_MAP.get(cat_key, {}).get("types", []):
            item_in_complement = True
            score += 3.0
            break

    # Bonus: popular items (worn often = user likes them)
    score += min(item.wear_count or 0, 10) * 0.2

    # Bonus: has AI tags (richer metadata = better match quality)
    if item.primary_color:
        score += 0.5
    if item.style:
        score += 0.3

    return score


async def _find_related_for_products(
    db: AsyncSession,
    user_id,
    products: list,
    gap_category: str | None,
) -> dict[int, list[dict]]:
    """Find the best matching wardrobe item for each product.

    Returns a dict mapping product index -> list of related item dicts.
    Each product gets a unique best-match from the user's wardrobe, with
    preference for color/style complementarity.
    """
    from app.utils.signed_urls import sign_image_url

    # Fetch all user wardrobe items
    result = await db.execute(
        select(ClothingItem).where(
            ClothingItem.user_id == user_id,
            ClothingItem.is_archived.is_(False),
        ).order_by(ClothingItem.wear_count.desc())
    )
    all_items = list(result.scalars().all())

    if not all_items:
        return {}

    # Determine what product categories we're dealing with
    # If we have a gap_category, products are all in that category
    product_cats = [gap_category or "top"] * len(products)

    # Try to infer category from product title/category_name
    CATEGORY_KEYWORDS = {
        "top": ["T恤", "衬衫", "卫衣", "毛衣", "上衣", "polo", "背心"],
        "bottom": ["裤", "裙", "牛仔", "短裤", "半裙"],
        "dress": ["连衣裙", "裙", "套装裙"],
        "shoes": ["鞋", "靴", "拖鞋", "凉鞋", "板鞋"],
        "outerwear": ["外套", "夹克", "风衣", "大衣", "开衫", "西装"],
        "accessories": ["包", "帽", "围巾", "腰带", "项链", "耳环"],
    }

    for i, p in enumerate(products):
        title_and_cat = f"{getattr(p, 'title', '')} {getattr(p, 'category_name', '')}"
        for cat_key, keywords in CATEGORY_KEYWORDS.items():
            if any(kw in title_and_cat for kw in keywords):
                product_cats[i] = cat_key
                break

    # Score and assign unique best-matches
    result_map: dict[int, list[dict]] = {}
    used_item_ids: set = set()

    for idx, (product, prod_cat) in enumerate(zip(products, product_cats)):
        candidates = []
        for item in all_items:
            if item.id in used_item_ids:
                continue
            score = _match_score(item, prod_cat)
            candidates.append((score, item))

        # Sort by score descending, pick top 1-2
        candidates.sort(key=lambda x: x[0], reverse=True)
        related = []
        for _, item in candidates[:2]:
            used_item_ids.add(item.id)
            thumb = sign_image_url(item.image_path) if item.image_path else None
            related.append({
                "thumbnail_url": thumb,
                "name": item.name or item.type or "衣物",
            })

        if related:
            result_map[idx] = related

    # If we have items left over and some products got nothing, fill from unused
    empty_indices = [i for i in range(len(products)) if i not in result_map]
    if empty_indices:
        remaining = [item for item in all_items if item.id not in used_item_ids]
        for idx in empty_indices:
            if not remaining:
                break
            item = remaining.pop(0)
            thumb = sign_image_url(item.image_path) if item.image_path else None
            result_map[idx] = [{
                "thumbnail_url": thumb,
                "name": item.name or item.type or "衣物",
            }]

    return result_map


# Keywords for inferring real category from outfit item name/description
_INFER_KEYWORDS: dict[str, list[str]] = {
    "top": ["上衣", "衬衫", "T恤", "卫衣", "毛衣", "西装外套", "夹克", "背心", "polo", "针织"],
    "bottom": ["裤子", "牛仔裤", "短裤", "裙子", "半裙", "阔腿裤", "西裤", "裤"],
    "dress": ["连衣裙", "套装裙", "长裙"],
    "shoes": ["鞋", "靴", "拖鞋", "凉鞋", "板鞋", "运动鞋"],
    "outerwear": ["外套", "风衣", "大衣", "开衫", "棉服", "羽绒"],
    "accessories": ["包", "帽", "围巾", "腰带", "项链", "耳环", "手链"],
}


def _infer_category(item_type: str, name: str = "", description: str = "") -> str:
    """Infer the real category key for an item, handling 'outfit' type."""
    if item_type in CATEGORY_MAP:
        return item_type
    # Try to infer from name/description
    infer_text = (name or "") + " " + (description or "")
    for cat_key, keywords in _INFER_KEYWORDS.items():
        if any(kw in infer_text for kw in keywords):
            return cat_key
    return ""  # Unknown


async def _analyze_wardrobe_gaps(
    db: AsyncSession,
    user_id,
) -> list[WardrobeGap]:
    """Analyze user wardrobe and find category gaps."""
    result = await db.execute(
        select(ClothingItem).where(
            ClothingItem.user_id == user_id,
            ClothingItem.is_archived == False,
        )
    )
    all_items = list(result.scalars().all())

    # Count items per category, inferring for "outfit" type
    cat_counts: dict[str, int] = {k: 0 for k in CATEGORY_MAP}
    for item in all_items:
        real_cat = _infer_category(item.type or "", item.name or "", item.ai_description or "")
        if real_cat:
            cat_counts[real_cat] += 1

    total = sum(cat_counts.values())

    gaps = []
    for cat_key, cat_info in CATEGORY_MAP.items():
        cat_count = cat_counts.get(cat_key, 0)
        # A category is a "gap" if it has 0 items relative to total wardrobe size
        if cat_count == 0 and total >= 3:
            gaps.append(WardrobeGap(
                category=cat_key,
                label=cat_info["label"],
                reason=f"\u4f60\u7684\u8863\u6a71\u8fd8\u6ca1\u6709{cat_info['label']}",
                count=0,
                keyword=cat_info["keywords"][0],
            ))
        elif cat_count <= 1 and total >= 8:
            # Low coverage
            gaps.append(WardrobeGap(
                category=cat_key,
                label=cat_info["label"],
                reason=f"{cat_info['label']}\u53ea\u6709{cat_count}\u4ef6\uff0c\u53ef\u4ee5\u591a\u51e0\u4ef6\u66f4\u597d\u642d\u914d",
                count=cat_count,
                keyword=cat_info["keywords"][0],
            ))

    # Sort: gaps with 0 items first, then by category priority (clothing > accessories)
    # This ensures default recommendations show varied clothing items, not just bags
    _GAP_PRIORITY = {
        "top": 0,        # 上衣最基础
        "bottom": 1,     # 下装第二
        "shoes": 2,      # 鞋子第三
        "outerwear": 3,
        "dress": 4,
        "accessories": 5,
    }
    gaps.sort(key=lambda g: (g.count, _GAP_PRIORITY.get(g.category, 99)))
    return gaps


def _get_current_season() -> str:
    """Return current season based on month."""
    month = datetime.now().month
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    if month in (9, 10, 11):
        return "autumn"
    return "winter"


def _check_seasonal_needs(gaps: list[WardrobeGap], season: str, gender: str | None) -> dict | None:
    """Check if user has seasonal wardrobe gaps."""
    gk = _get_gender_key(gender)
    SEASONAL_NEEDS = {
        "winter": {
            "outerwear": ("保暖外套", "冬天需要一件好外套"),
        },
        "summer": {
            "top": ("短袖", "夏天需要透气的上衣"),
        },
        "spring": {
            "outerwear": ("薄外套", "春天早晚温差大"),
            "top": ("长袖", "春季穿搭需要"),
        },
        "autumn": {
            "outerwear": ("风衣", "秋天是风衣的季节"),
            "top": ("针织衫", "秋天穿针织衫正合适"),
        },
    }
    needs = SEASONAL_NEEDS.get(season, {})
    gap_cats = {g.category: g for g in gaps}
    for cat, (keyword, reason) in needs.items():
        if cat in gap_cats and gap_cats[cat].count == 0:
            gender_kw = _GENDER_KEYWORDS.get(cat, {}).get(gk, [keyword])
            return {
                "keyword": gender_kw[0] if gender_kw else keyword,
                "reason": reason,
                "category": "",
            }
    return None


async def _get_recent_worn_categories(db: AsyncSession, user_id, days: int = 7) -> dict[str, int]:
    """Get how many times each category was worn in the last N days."""
    from app.models.outfit import Outfit, OutfitItem

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    # Find outfits created recently
    result = await db.execute(
        select(OutfitItem.item_id).join(Outfit).where(
            Outfit.user_id == user_id,
            Outfit.created_at >= cutoff,
        )
    )
    worn_item_ids = [row[0] for row in result.all()]
    if not worn_item_ids:
        return {}

    # Get those items and count by category
    items_result = await db.execute(
        select(ClothingItem).where(ClothingItem.id.in_(worn_item_ids))
    )
    cat_counts: dict[str, int] = {}
    for item in items_result.scalars().all():
        cat = _infer_category(item.type or "", item.name or "", item.ai_description or "")
        if cat:
            cat_counts[cat] = cat_counts.get(cat, 0) + 1
    return cat_counts


def _check_repeat_pattern(recent_worn: dict[str, int], gender: str | None) -> dict | None:
    """If a category was worn too frequently, suggest variety."""
    gk = _get_gender_key(gender)
    # If shoes worn 4+ days in a week, suggest different shoes
    VARIETY_TRIGGERS = {
        "shoes": (4, "最近常穿同类鞋子，换双新的？"),
        "top": (5, "最近上衣穿得比较重复"),
        "bottom": (5, "最近下装穿得比较重复"),
    }
    for cat, (threshold, reason) in VARIETY_TRIGGERS.items():
        if recent_worn.get(cat, 0) >= threshold:
            keywords = _GENDER_KEYWORDS.get(cat, {}).get(gk, ["服装"])
            # Pick a different keyword than what they've been wearing
            kw = random.choice(keywords) if keywords else "服装"
            return {"keyword": kw, "reason": reason, "category": ""}
    return None


async def _build_contextual_keyword(db: AsyncSession, user_id) -> tuple[str, str, str]:
    """Generate a context-aware recommendation keyword.

    Combines: season + weather + recent wear + wardrobe gaps + user profile.
    Falls back to gap-based recommendation if no context triggers.
    """
    pref, learning = await _get_user_profile(db, user_id)
    gender = pref.gender if pref else None
    user_style = _get_user_style(pref, learning)
    gk = _get_gender_key(gender)

    season = _get_current_season()
    gaps = await _analyze_wardrobe_gaps(db, user_id)
    recent_worn = await _get_recent_worn_categories(db, user_id, days=7)

    # Priority 1: Seasonal needs (cold weather without coat, etc.)
    strategy = _check_seasonal_needs(gaps, season, gender)
    if strategy:
        return strategy["keyword"], strategy["reason"], strategy["category"]

    # Priority 2: Repeat pattern (wearing same shoes 4 days straight)
    strategy = _check_repeat_pattern(recent_worn, gender)
    if strategy:
        return strategy["keyword"], strategy["reason"], strategy["category"]

    # Fallback: trending keywords — 按性别选词表（旧版只有女装词表，男性用户会搜出一堆女装）
    _SAFE_KEYWORDS_FEMALE = [
        ("韩系 针织衫 显瘦 百搭", "温柔韩系上衣", ""),
        ("法式 碎花裙 氛围感 显瘦", "法式连衣裙", ""),
        ("阔腿裤 高腰 显腿长 百搭", "显瘦百搭下装", ""),
        ("极简 白衬衫 质感 通勤", "百搭质感衬衫", ""),
        ("直筒牛仔裤 复古 显瘦", "经典百搭牛仔裤", ""),
        ("吊带裙 夏季 氛围感 显瘦", "夏日连衣裙", ""),
        ("乐福鞋 百搭 舒适 质感", "百搭质感鞋", ""),
        ("托特包 通勤 大容量 百搭", "实用百搭包包", ""),
        ("开衫 薄款 防晒 百搭", "夏季薄外套", ""),
        ("工装裤 高腰 显瘦 酷", "甜酷工装裤", ""),
        ("新中式 连衣裙 气质", "新中式连衣裙", ""),
        ("polo领 T恤 简约 百搭", "百搭polo衫", ""),
        ("玛丽珍鞋 复古 甜美", "复古玛丽珍鞋", ""),
        ("鲨鱼裤 外穿 显瘦 收腹", "百搭鲨鱼裤", ""),
        ("帆布包 文艺 百搭 通勤", "文艺帆布包", ""),
    ]
    _SAFE_KEYWORDS_MALE = [
        ("男士 休闲外套 春秋 百搭", "男士休闲外套", ""),
        ("男士 直筒牛仔裤 复古 百搭", "男士牛仔裤", ""),
        ("男士 针织衫 简约 内搭", "男士针织衫", ""),
        ("男士 衬衫 免烫 通勤", "男士通勤衬衫", ""),
        ("男士 卫衣 宽松 潮流", "男士卫衣", ""),
        ("男士 运动鞋 轻便 百搭", "男士运动鞋", ""),
        ("男士 工装裤 直筒 宽松", "男士工装裤", ""),
        ("男士 夹克 休闲 百搭", "男士夹克", ""),
        ("男士 西装外套 商务 修身", "男士西装外套", ""),
        ("男士 双肩包 通勤 大容量", "男士双肩包", ""),
        ("男士 polo衫 商务 简约", "男士polo衫", ""),
        ("男士 直筒休闲裤 显腿长", "男士休闲裤", ""),
        ("男士 毛衣 圆领 基础款", "男士毛衣", ""),
        ("男士 羽绒服 冬季 保暖", "男士羽绒服", ""),
        ("男士 板鞋 百搭 舒适", "男士板鞋", ""),
    ]
    is_male = (gender or "").lower().startswith("m")
    pool = _SAFE_KEYWORDS_MALE if is_male else _SAFE_KEYWORDS_FEMALE
    kw, reason, cat = random.choice(pool)
    return kw, reason, cat


# ===== Endpoints =====

@router.get("/gaps", response_model=WardrobeGapListResponse)
async def get_wardrobe_gaps(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WardrobeGapListResponse:
    """Analyze wardrobe and return missing/low categories."""
    # Total item count
    count_result = await db.execute(
        select(func.count(ClothingItem.id))
        .where(ClothingItem.user_id == current_user.id, ClothingItem.is_archived == False)
    )
    total = count_result.scalar() or 0

    gaps = await _analyze_wardrobe_gaps(db, current_user.id)
    return WardrobeGapListResponse(gaps=gaps, total_items=total)


@router.get("/recommend", response_model=ProductRecommendResponse)
async def recommend_products(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    keyword: str = Query("", description="Search keyword (explicit override)"),
    gap_category: str = Query("", description="Gap category key"),
    item_id: str = Query("", description="Recommend based on this item's style/color"),
    scene: str = Query("", description="Scene: commute/date/casual/sport/party/travel"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> ProductRecommendResponse:
    """Search products with personalized keywords.

    Recommendation modes (priority: keyword > item_id > scene/gap > contextual auto):
    1. keyword: explicit search term (user typed in search box)
    2. item_id: based on a specific wardrobe item's color/style + complementary category
    3. scene: scene-based recommendation (commute/date/casual/sport)
    4. gap_category: fill a specific wardrobe gap
    5. auto (default): context-aware engine combining season, recent wear, gaps, and style profile
    """
    gap = None
    keyword_used = keyword
    target_cat = gap_category or ''
    reason = ""

    # If explicit keyword provided, use it directly (backward compatible)
    if keyword:
        # Still build a WardrobeGap if gap_category is given
        if gap_category:
            cat_info = CATEGORY_MAP.get(gap_category)
            if cat_info:
                gap = WardrobeGap(
                    category=gap_category,
                    label=cat_info["label"],
                    reason="",
                    count=0,
                    keyword=keyword,
                )
        reason = f"搜索「{keyword}」"
    else:
        # Use smart keyword generation
        parsed_item_id = None
        if item_id:
            try:
                parsed_item_id = UUID(item_id) if isinstance(item_id, str) else item_id
            except (ValueError, AttributeError):
                parsed_item_id = None

        if parsed_item_id or scene or gap_category:
            # Targeted modes: item-based, scene-based, or specific gap
            keyword, reason, target_cat = await _build_smart_keyword(
                db, current_user.id,
                gap_category=gap_category or None,
                item_id=parsed_item_id,
                scene=scene or None,
            )
        else:
            # Auto mode: context-aware recommendation
            keyword, reason, target_cat = await _build_contextual_keyword(
                db, current_user.id,
            )
        keyword_used = keyword

        # Build WardrobeGap for response if gap_category is involved
        if gap_category:
            cat_info = CATEGORY_MAP.get(gap_category)
            if cat_info:
                gap = WardrobeGap(
                    category=gap_category,
                    label=cat_info["label"],
                    reason=reason,
                    count=0,
                    keyword=keyword,
                )

    # 画像个性化：身材/体型推导的版型限定词接进搜索词与推荐理由
    keyword, reason, user_gender = await _personalize_keyword(
        db, current_user.id, keyword, reason
    )
    keyword_used = keyword

    products = await search_products(keyword=keyword, page=page, page_size=page_size * 2)

    # Dedup: remove products too similar to what user already owns
    if target_cat:
        wardrobe_result = await db.execute(
            select(ClothingItem).where(
                ClothingItem.user_id == current_user.id,
                ClothingItem.is_archived.is_(False),
            )
        )
        wardrobe_items = list(wardrobe_result.scalars().all())
        products = _dedup_products_against_wardrobe(products, wardrobe_items, target_cat)

    # Post-filter: keep only products that match the target category
    if target_cat:
        target_cat_info = CATEGORY_MAP.get(target_cat, {})
        target_types = target_cat_info.get("types", [])
        target_keywords = target_cat_info.get("keywords", [])
        # Also use _INFER_KEYWORDS for broader matching
        infer_kws = _INFER_KEYWORDS.get(target_cat, [])

        filtered = []
        for p in products:
            title = (p.title or "").lower() + " " + (p.category_name or "").lower()
            if any(kw in title for kw in target_keywords + infer_kws):
                filtered.append(p)
            elif any(t in (p.category_name or "").lower() for t in target_types):
                filtered.append(p)
        # Keep matched results; only fall back if nothing matched at all
        if not filtered:
            filtered = products[:3]
        products = filtered[:page_size]
    else:
        products = products[:page_size]

    # 质量闸门：剔除与画像矛盾的商品（性别/童装/中老年等）
    products = _apply_profile_gate(products, user_gender)

    # Per-product related_items
    # If recommending based on a specific item, always show that item as related
    related_map: dict[int, list[dict]] = {}
    if item_id:
        try:
            target_item_id = UUID(item_id) if isinstance(item_id, str) else item_id
            item_result = await db.execute(
                select(ClothingItem).where(
                    ClothingItem.id == target_item_id,
                    ClothingItem.user_id == current_user.id,
                )
            )
            target_item = item_result.scalar_one_or_none()
            if target_item:
                from app.utils.signed_urls import sign_image_url
                thumb = sign_image_url(target_item.image_path) if target_item.image_path else None
                related_entry = [{
                    "thumbnail_url": thumb,
                    "name": target_item.name or target_item.type or "\u8863\u7269",
                }]
                for idx in range(len(products)):
                    related_map[idx] = related_entry
        except (ValueError, AttributeError):
            pass

    # Fill remaining products with standard related items
    if len(related_map) < len(products):
        standard_map = await _find_related_for_products(
            db, current_user.id, products, gap.category if gap else None
        )
        for idx, items in standard_map.items():
            if idx not in related_map:
                related_map[idx] = items

    logger.info(
        "Product recommend: keyword=%s, item_id=%s, scene=%s, products=%d, related=%d",
        keyword, item_id, scene, len(products), len(related_map),
    )

    return ProductRecommendResponse(
        products=[
            ProductResponse(
                title=p.title,
                pic_url=p.pic_url,
                price=p.price,
                original_price=p.original_price,
                volume=p.volume,
                shop_title=p.shop_title,
                item_url=p.item_url,
                category_name=p.category_name,
                related_items=related_map.get(idx, []),
            )
            for idx, p in enumerate(products)
        ],
        gap=gap,
        total=len(products),
        page=page,
        has_more=len(products) >= page_size,
        keyword_used=keyword_used,
        reason=reason,
    )


@router.post("/complete-outfit", response_model=CompleteOutfitResponse)
async def complete_outfit(
    req: CompleteOutfitRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CompleteOutfitResponse:
    """Find complementary products to complete an outfit.

    Given 1-5 wardrobe items, identifies missing categories and searches
    for products that color/style-match the selected items.
    """
    from app.utils.signed_urls import sign_image_url

    # 1. Fetch selected items
    selected_items = []
    for item_id_str in req.item_ids:
        try:
            item_id = UUID(item_id_str)
        except ValueError:
            continue
        result = await db.execute(
            select(ClothingItem).where(
                ClothingItem.id == item_id,
                ClothingItem.user_id == current_user.id,
            )
        )
        item = result.scalar_one_or_none()
        if item:
            selected_items.append(item)

    if not selected_items:
        return CompleteOutfitResponse(groups=[], selected_items=[], keyword_used="")

    # 2. Determine what categories the selected items belong to
    selected_cats = set()
    for item in selected_items:
        cat = _infer_category(item.type or "", item.name or "", item.ai_description or "")
        if cat:
            selected_cats.add(cat)

    # 3. Determine missing categories (what's needed to complete the outfit)
    all_cats = {"top", "bottom", "shoes", "outerwear", "accessories"}
    if req.target_category:
        missing_cats = {req.target_category}
    else:
        missing_cats = all_cats - selected_cats
        # Prioritize: shoes > accessories > outerwear
        priority = ["shoes", "accessories", "outerwear", "top", "bottom"]
        missing_cats = sorted(missing_cats, key=lambda c: priority.index(c) if c in priority else 99)
        # Limit to 2 categories to avoid too many API calls
        missing_cats = missing_cats[:2]

    # 4. Extract color/style context from selected items
    colors = []
    styles = []
    for item in selected_items:
        if item.primary_color:
            colors.append(item.primary_color)
        if item.style:
            styles.extend(item.style)

    # Pick the dominant color for matching
    dominant_color = colors[0] if colors else ""
    dominant_style = ""
    for s in styles:
        if s in STYLE_LABELS:
            dominant_style = STYLE_LABELS[s]
            break

    # 5. Build selected items info for response
    selected_info = []
    for item in selected_items:
        thumb = sign_image_url(item.image_path) if item.image_path else None
        selected_info.append({
            "id": str(item.id),
            "name": item.name or item.type or "衣物",
            "thumbnail_url": thumb,
            "category": _infer_category(item.type or "", item.name or "", item.ai_description or ""),
        })

    # 6. Search for products in each missing category
    _, user_gender = await _load_fit_context(db, current_user.id)
    groups = []
    all_keywords = []
    for cat in missing_cats:
        cat_info = CATEGORY_MAP.get(cat, {})
        cat_label = cat_info.get("label", cat)

        # Build keyword: style + color harmony + category
        color_part = ""
        if dominant_color:
            color_part = _pick_pairing_color(dominant_color, cat, "")

        # Pick precise keyword based on formality of selected items
        formality = "default"
        for item in selected_items:
            item_text = (item.name or "") + " " + (item.ai_description or "")
            if any(w in item_text for w in ["西装", "正装", "商务"]):
                formality = "formal"
                break
            if any(w in item_text for w in ["优雅", "法式", "气质"]):
                formality = "elegant"
                break
            if any(w in item_text for w in ["休闲", "运动", "T恤"]):
                formality = "casual"
                break

        _CAT_KEYWORDS_FEMALE = {
            "shoes": {"formal": "高跟鞋", "elegant": "玛丽珍鞋", "casual": "运动鞋", "default": "单鞋"},
            "accessories": {"formal": "手提包", "elegant": "斜挎包", "casual": "帆布包", "default": "女包"},
            "outerwear": {"formal": "西装外套", "elegant": "针织开衫", "casual": "夹克", "default": "薄外套"},
            "top": {"formal": "衬衫", "elegant": "针织衫", "casual": "T恤", "default": "上衣"},
            "bottom": {"formal": "西裤", "elegant": "阔腿裤", "casual": "牛仔裤", "default": "裤子"},
        }
        _CAT_KEYWORDS_MALE = {
            "shoes": {"formal": "皮鞋", "elegant": "乐福鞋", "casual": "运动鞋", "default": "男鞋"},
            "accessories": {"formal": "公文包", "elegant": "单肩包", "casual": "双肩包", "default": "男包"},
            "outerwear": {"formal": "西装外套", "elegant": "风衣", "casual": "夹克", "default": "男士外套"},
            "top": {"formal": "衬衫", "elegant": "针织衫", "casual": "T恤", "default": "男士上衣"},
            "bottom": {"formal": "西裤", "elegant": "直筒裤", "casual": "牛仔裤", "default": "休闲裤"},
        }
        _cat_kw = _CAT_KEYWORDS_MALE if (user_gender or "").lower().startswith("m") else _CAT_KEYWORDS_FEMALE
        specific_kw = _cat_kw.get(cat, {}).get(formality, cat_info.get("keywords", ["服装"])[0])

        parts = [p for p in [dominant_style, color_part, specific_kw] if p]
        keyword = " ".join(parts)
        all_keywords.append(keyword)

        products = await search_products(keyword=keyword, page=1, page_size=10)

        # Post-filter for category match
        target_kws = cat_info.get("keywords", [])
        infer_kws = _INFER_KEYWORDS.get(cat, [])
        filtered = []
        for p in products:
            title = (p.title or "").lower() + " " + (p.category_name or "").lower()
            if any(kw in title for kw in target_kws + infer_kws):
                filtered.append(p)
        if len(filtered) < 2:
            filtered = products[:6]
        products = filtered[:6]

        # 质量闸门：剔除与画像矛盾的商品
        products = _apply_profile_gate(products, user_gender)

        # Build related items (the selected items)
        related = []
        for item in selected_items[:2]:
            thumb = sign_image_url(item.image_path) if item.image_path else None
            related.append({"thumbnail_url": thumb, "name": item.name or item.type or "衣物"})

        reason = f"搭配你的{'、'.join(i.name or i.type for i in selected_items[:2])}"

        groups.append(CategoryProducts(
            category=cat,
            label=cat_label,
            reason=reason,
            products=[
                ProductResponse(
                    title=p.title,
                    pic_url=p.pic_url,
                    price=p.price,
                    original_price=p.original_price,
                    volume=p.volume,
                    shop_title=p.shop_title,
                    item_url=p.item_url,
                    category_name=p.category_name,
                    related_items=related,
                )
                for p in products
            ],
        ))

    logger.info(
        "Complete outfit: items=%d, missing_cats=%s, keywords=%s, groups=%d",
        len(selected_items), list(missing_cats), all_keywords, len(groups),
    )

    return CompleteOutfitResponse(
        groups=groups,
        selected_items=selected_info,
        keyword_used=" + ".join(all_keywords),
    )
