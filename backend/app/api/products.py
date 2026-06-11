"""Product recommendation API endpoints."""

import logging
import random
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import ClothingItem
from app.models.user import User
from app.models.preference import UserPreference
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


async def _build_smart_keyword(
    db: AsyncSession,
    user_id,
    gap_category: str | None = None,
    item_id: UUID | None = None,
    scene: str | None = None,
) -> tuple[str, str]:
    """Generate a personalized search keyword for product recommendation.

    Returns (keyword, reason) where reason explains why this keyword was chosen.

    Three modes:
    1. Based on a specific item (item_id) -> find complementary products
    2. Based on wardrobe gap (gap_category) -> fill missing categories
    3. Based on scene (scene) -> scene-appropriate products
    """
    # Fetch user preferences
    pref_result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    )
    pref = pref_result.scalar_one_or_none()

    # Extract user style and color preferences
    user_style = ""
    if pref and pref.style_identity:
        for sid in pref.style_identity:
            if sid in STYLE_LABELS:
                user_style = STYLE_LABELS[sid]
                break

    user_color = ""
    if pref and pref.color_favorites:
        user_color = pref.color_favorites[0]

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
                item, target_cat, item_style or user_style
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
                _SCENE_SMART_KEYWORDS = {
                    "bottom": ["阔腿裤", "西裤", "牛仔裤", "半身裙"],
                    "top": ["衬衫", "针织衫", "T恤", "雪纺衫"],
                    "shoes": ["高跟鞋", "运动鞋", "单鞋", "板鞋"],
                    "outerwear": ["风衣", "针织开衫", "西装外套", "薄外套"],
                    "dress": ["连衣裙", "法式连衣裙", "碎花裙"],
                    "accessories": ["斜挛包", "丝巾", "手提包"],
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
            # Use smarter default keywords per category
            _GAP_SMART_KEYWORDS = {
                "bottom": ["阔腿裤", "西裤", "牛仔裤", "半身裙"],
                "top": ["衬衫", "针织衫", "T恤", "雪纺衫"],
                "shoes": ["高跟鞋", "运动鞋", "单鞋", "板鞋"],
                "outerwear": ["风衣", "针织开衫", "西装外套", "薄外套"],
                "dress": ["连衣裙", "法式连衣裙", "碎花裙"],
                "accessories": ["斜挛包", "丝巾", "手提包"],
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



def _pick_complement_keyword(item, target_cat: str, style_hint: str = "") -> str:
    """Pick a precise search keyword for the complementary category based on item features.

    Instead of generic "裤子", returns specific terms like "西裤", "阔腿裤" based on
    the item's style, name, material, and occasion.
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

    # Keyword candidates per complementary category, ordered by specificity
    _PRECISE_KEYWORDS = {
        "bottom": {
            "formal": ["西裤", "西装裤", "直筒裤", "高腰裤"],
            "elegant": ["阔腿裤", "半身裙", "高腰裤", "百褶裙"],
            "casual": ["牛仔裤", "休闲裤", "运动裤"],
            "default": ["裤子", "阔腿裤"],
        },
        "top": {
            "formal": ["衬衫", "雪纺衫", "打底衫"],
            "elegant": ["针织衫", "雪纺衫", "蕾丝衫"],
            "casual": ["T恤", "卫衣", "POLO衫"],
            "default": ["上衣", "衬衫"],
        },
        "shoes": {
            "formal": ["高跟鞋", "尖头鞋", "皮鞋"],
            "elegant": ["高跟鞋", "玛丽珍鞋", "尖头鞋"],
            "casual": ["运动鞋", "板鞋", "帆布鞋"],
            "default": ["鞋子", "单鞋"],
        },
        "outerwear": {
            "formal": ["西装外套", "风衣", "大衣"],
            "elegant": ["针织开衫", "薄外套", "风衣"],
            "casual": ["夹克", "棒球服", "卫衣外套"],
            "default": ["外套", "薄外套"],
        },
        "dress": {
            "formal": ["连衣裙", "职业裙"],
            "elegant": ["法式连衣裙", "碎花裙", "气质连衣裙"],
            "casual": ["连衣裙", "T恤裙"],
            "default": ["连衣裙"],
        },
        "accessories": {
            "formal": ["手提包", "公文包", "丝巾"],
            "elegant": ["斜挎包", "珍珠项链", "丝巾"],
            "casual": ["帆布包", "棒球帽", "运动包"],
            "default": ["女包", "围巾"],
        },
    }

    cat_keywords = _PRECISE_KEYWORDS.get(target_cat, _PRECISE_KEYWORDS.get("bottom"))
    if is_formal:
        candidates = cat_keywords.get("formal", cat_keywords["default"])
    elif is_elegant:
        candidates = cat_keywords.get("elegant", cat_keywords["default"])
    elif is_casual:
        candidates = cat_keywords.get("casual", cat_keywords["default"])
    else:
        candidates = cat_keywords["default"]

    return candidates[0]


def _pick_pairing_color(item_color: str, target_cat: str, user_pref_color: str = "") -> str:
    """Pick a harmonious color for the complementary item.

    Fashion rules:
    - Neutral tops (black/white/gray) -> any color bottom works, prefer dark
    - Colored top -> neutral bottom (black/navy/white)
    - Formal items -> prefer dark neutrals
    """

    ic = (item_color or "").lower()
    neutral_colors = {"black", "white", "gray", "grey", "beige", "navy", "cream", "khaki", "brown"}

    # For bottoms/shoes complementing a top: prefer dark neutrals
    if target_cat in ("bottom", "shoes"):
        if ic in ("gray", "grey"):
            return "黑色"  # gray top -> black bottom (classic contrast)
        if ic in ("black", "navy"):
            return ""  # black top -> any bottom, skip color to broaden results
        if ic in ("white", "cream"):
            return "黑色"  # white top -> black bottom (classic)
        if ic in neutral_colors:
            return "黑色"
        # Colored top -> neutral bottom
        return "黑色"

    # For tops complementing a bottom
    if target_cat == "top":
        if ic in neutral_colors:
            return ""  # neutral bottom -> any top works
        return "白色"  # colored bottom -> white top

    # For accessories/outerwear/dress: don't restrict color
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

    total = len(all_items)
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
        "bottom": 0,   # pants/skirts most needed for outfits
        "shoes": 1,    # shoes second most important
        "top": 2,
        "outerwear": 3,
        "dress": 4,
        "accessories": 5,  # bags/scarves least urgent
    }
    gaps.sort(key=lambda g: (g.count, _GAP_PRIORITY.get(g.category, 99)))
    return gaps


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

    Three recommendation modes (priority: keyword > item_id > scene > gap > auto):
    1. keyword: explicit search term (legacy, highest priority)
    2. item_id: based on a specific wardrobe item's color/style + complementary category
    3. scene: scene-based recommendation (commute/date/casual/sport)
    4. gap_category: fill a specific wardrobe gap
    5. auto: detect the biggest gap automatically
    """
    gap = None
    keyword_used = keyword
    target_cat = gap_category or ''

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
    else:
        # Use smart keyword generation
        parsed_item_id = None
        if item_id:
            try:
                parsed_item_id = UUID(item_id) if isinstance(item_id, str) else item_id
            except (ValueError, AttributeError):
                parsed_item_id = None

        keyword, reason, target_cat = await _build_smart_keyword(
            db, current_user.id,
            gap_category=gap_category or None,
            item_id=parsed_item_id,
            scene=scene or None,
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

    products = await search_products(keyword=keyword, page=page, page_size=page_size * 2)

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
            # Match if title contains any target keyword or infer keyword
            if any(kw in title for kw in target_keywords + infer_kws):
                filtered.append(p)
            # Also match if category_name matches target types
            elif any(t in (p.category_name or "").lower() for t in target_types):
                filtered.append(p)
        # If filtering removed too many, keep some originals
        if len(filtered) < 3:
            filtered = products[:page_size]
        products = filtered[:page_size]
    else:
        products = products[:page_size]

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
    )
