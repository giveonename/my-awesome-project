from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, computed_field
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import Outfit, OutfitStatus, UserFeedback
from app.models.user import User
from app.utils.auth import get_current_user
from app.utils.signed_urls import sign_image_url

# 颜色英文→中文映射（用于 AI 洞察生成）
COLOR_CN = {
    "black": "黑色",
    "white": "白色",
    "gray": "灰色",
    "grey": "灰色",
    "navy": "藏青色",
    "blue": "蓝色",
    "light-blue": "浅蓝色",
    "red": "红色",
    "burgundy": "酒红色",
    "pink": "粉色",
    "green": "绿色",
    "olive": "橄榄绿",
    "yellow": "黄色",
    "orange": "橙色",
    "purple": "紫色",
    "brown": "棕色",
    "tan": "卡其色",
    "beige": "米色",
    "cream": "奶油色",
    "gold": "金色",
    "silver": "银色",
    "khaki": "卡其色",
    "maroon": "栗色",
    "teal": "青色",
    "charcoal": "炭灰色",
    "wine": "酒红色",
}

# 衣物类型英文→中文映射
TYPE_CN = {
    "shirt": "衬衫",
    "t-shirt": "T恤",
    "blouse": "衬衫",
    "top": "上衣",
    "pants": "裤子",
    "jeans": "牛仔裤",
    "skirt": "裙子",
    "shorts": "短裤",
    "dress": "连衣裙",
    "jacket": "夹克",
    "coat": "外套",
    "sweater": "毛衣",
    "hoodie": "卫衣",
    "blazer": "西装外套",
    "shoes": "鞋子",
    "sneakers": "运动鞋",
    "boots": "靴子",
    "accessories": "配饰",
    "hat": "帽子",
    "bag": "包",
}

router = APIRouter(prefix="/analytics", tags=["Analytics"])


class ColorDistribution(BaseModel):
    color: str
    count: int
    percentage: float


class TypeDistribution(BaseModel):
    type: str
    count: int
    percentage: float


class WearStats(BaseModel):
    id: UUID
    name: str | None
    type: str
    primary_color: str | None
    thumbnail_path: str | None
    wear_count: int
    last_worn_at: date | None

    @computed_field
    @property
    def thumbnail_url(self) -> str | None:
        if self.thumbnail_path:
            return sign_image_url(self.thumbnail_path)
        return None


class AcceptanceRateTrend(BaseModel):
    period: str
    total: int
    accepted: int
    rejected: int
    rate: float


class WardrobeStats(BaseModel):
    total_items: int
    items_by_status: dict[str, int]
    total_outfits: int
    outfits_this_week: int
    outfits_this_month: int
    acceptance_rate: float | None
    average_rating: float | None
    total_wears: int
    # 衣橱价值（cost-per-wear）：只统计填了购买价格的衣物
    priced_items: int = 0
    total_spend: float | None = None
    average_cpw: float | None = None


class AnalyticsResponse(BaseModel):
    wardrobe: WardrobeStats
    color_distribution: list[ColorDistribution]
    type_distribution: list[TypeDistribution]
    most_worn: list[WearStats]
    least_worn: list[WearStats]
    never_worn: list[WearStats]
    acceptance_trend: list[AcceptanceRateTrend]
    insights: list[str]


@router.get("", response_model=AnalyticsResponse)
async def get_analytics(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    days: int = Query(30, ge=7, le=365, description="Number of days for trends"),
) -> AnalyticsResponse:
    # Calculate date ranges
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    # === Wardrobe Stats ===
    # Total items and status breakdown
    items_query = select(
        func.count(ClothingItem.id).label("total"),
        func.sum(case((ClothingItem.status == ItemStatus.ready, 1), else_=0)).label("ready"),
        func.sum(case((ClothingItem.status == ItemStatus.processing, 1), else_=0)).label(
            "processing"
        ),
        func.sum(case((ClothingItem.status == ItemStatus.archived, 1), else_=0)).label("archived"),
        func.sum(case((ClothingItem.status == ItemStatus.error, 1), else_=0)).label("error"),
        func.sum(ClothingItem.wear_count).label("total_wears"),
        func.sum(case((ClothingItem.purchase_price.isnot(None), 1), else_=0)).label("priced"),
        func.sum(
            case((ClothingItem.purchase_price.isnot(None), ClothingItem.purchase_price), else_=0)
        ).label("spend"),
        func.sum(
            case(
                (ClothingItem.purchase_price.isnot(None), ClothingItem.wear_count),
                else_=0,
            )
        ).label("priced_wears"),
    ).where(ClothingItem.user_id == current_user.id)

    items_result = await db.execute(items_query)
    items_row = items_result.one()

    total_items = items_row.total or 0
    items_by_status = {
        "ready": items_row.ready or 0,
        "processing": items_row.processing or 0,
        "archived": items_row.archived or 0,
        "error": items_row.error or 0,
    }
    total_wears = items_row.total_wears or 0

    # Outfit stats
    outfits_query = select(
        func.count(Outfit.id).label("total"),
        func.sum(case((Outfit.created_at >= week_ago, 1), else_=0)).label("this_week"),
        func.sum(case((Outfit.created_at >= month_ago, 1), else_=0)).label("this_month"),
        func.sum(case((Outfit.status == OutfitStatus.accepted, 1), else_=0)).label("accepted"),
        func.sum(case((Outfit.status == OutfitStatus.rejected, 1), else_=0)).label("rejected"),
    ).where(Outfit.user_id == current_user.id)

    outfits_result = await db.execute(outfits_query)
    outfits_row = outfits_result.one()

    total_outfits = outfits_row.total or 0
    outfits_this_week = outfits_row.this_week or 0
    outfits_this_month = outfits_row.this_month or 0
    accepted = outfits_row.accepted or 0
    rejected = outfits_row.rejected or 0

    responded = accepted + rejected
    acceptance_rate = (accepted / responded * 100) if responded > 0 else None

    # Average rating from feedback table
    rating_query = (
        select(func.avg(UserFeedback.rating))
        .join(Outfit)
        .where(and_(Outfit.user_id == current_user.id, UserFeedback.rating.isnot(None)))
    )
    rating_result = await db.execute(rating_query)
    avg_rating_raw = rating_result.scalar()
    average_rating = round(float(avg_rating_raw), 2) if avg_rating_raw else None

    wardrobe_stats = WardrobeStats(
        total_items=total_items,
        items_by_status=items_by_status,
        total_outfits=total_outfits,
        outfits_this_week=outfits_this_week,
        outfits_this_month=outfits_this_month,
        acceptance_rate=round(acceptance_rate, 1) if acceptance_rate else None,
        average_rating=average_rating,
        total_wears=total_wears,
        priced_items=int(items_row.priced or 0),
        total_spend=round(float(items_row.spend), 2) if items_row.spend else None,
        average_cpw=(
            round(float(items_row.spend) / int(items_row.priced_wears), 2)
            if items_row.spend and items_row.priced_wears
            else None
        ),
    )

    # === Color Distribution ===
    color_query = (
        select(
            ClothingItem.primary_color,
            func.count(ClothingItem.id).label("count"),
        )
        .where(
            and_(
                ClothingItem.user_id == current_user.id,
                ClothingItem.primary_color.isnot(None),
                ClothingItem.status == ItemStatus.ready,
            )
        )
        .group_by(ClothingItem.primary_color)
        .order_by(func.count(ClothingItem.id).desc())
        .limit(10)
    )
    color_result = await db.execute(color_query)
    color_rows = color_result.all()

    ready_items = items_by_status["ready"]
    color_distribution = [
        ColorDistribution(
            color=row.primary_color,
            count=row.count,
            percentage=round(row.count / ready_items * 100, 1) if ready_items > 0 else 0,
        )
        for row in color_rows
    ]

    # === Type Distribution ===
    type_query = (
        select(
            ClothingItem.type,
            func.count(ClothingItem.id).label("count"),
        )
        .where(
            and_(
                ClothingItem.user_id == current_user.id,
                ClothingItem.status == ItemStatus.ready,
            )
        )
        .group_by(ClothingItem.type)
        .order_by(func.count(ClothingItem.id).desc())
    )
    type_result = await db.execute(type_query)
    type_rows = type_result.all()

    type_distribution = [
        TypeDistribution(
            type=row.type,
            count=row.count,
            percentage=round(row.count / ready_items * 100, 1) if ready_items > 0 else 0,
        )
        for row in type_rows
    ]

    # === Most/Least/Never Worn ===
    def wear_stats_query(order_desc: bool, limit: int, never_worn: bool = False):
        q = select(ClothingItem).where(
            and_(
                ClothingItem.user_id == current_user.id,
                ClothingItem.status == ItemStatus.ready,
            )
        )
        if never_worn:
            q = q.where(ClothingItem.wear_count == 0)
            q = q.order_by(ClothingItem.created_at.desc())
        elif order_desc:
            q = q.where(ClothingItem.wear_count > 0)
            q = q.order_by(ClothingItem.wear_count.desc())
        else:
            q = q.where(ClothingItem.wear_count > 0)
            q = q.order_by(ClothingItem.wear_count.asc())
        return q.limit(limit)

    most_worn_result = await db.execute(wear_stats_query(order_desc=True, limit=5))
    most_worn = [
        WearStats(
            id=item.id,
            name=item.name,
            type=item.type,
            primary_color=item.primary_color,
            thumbnail_path=item.thumbnail_path,
            wear_count=item.wear_count,
            last_worn_at=item.last_worn_at,
        )
        for item in most_worn_result.scalars().all()
    ]

    least_worn_result = await db.execute(wear_stats_query(order_desc=False, limit=5))
    least_worn = [
        WearStats(
            id=item.id,
            name=item.name,
            type=item.type,
            primary_color=item.primary_color,
            thumbnail_path=item.thumbnail_path,
            wear_count=item.wear_count,
            last_worn_at=item.last_worn_at,
        )
        for item in least_worn_result.scalars().all()
    ]

    never_worn_result = await db.execute(
        wear_stats_query(order_desc=False, limit=5, never_worn=True)
    )
    never_worn = [
        WearStats(
            id=item.id,
            name=item.name,
            type=item.type,
            primary_color=item.primary_color,
            thumbnail_path=item.thumbnail_path,
            wear_count=item.wear_count,
            last_worn_at=item.last_worn_at,
        )
        for item in never_worn_result.scalars().all()
    ]

    # === Acceptance Rate Trend (weekly) ===
    acceptance_trend = []
    weeks = min(days // 7, 12)  # Max 12 weeks

    for i in range(weeks):
        week_end = now - timedelta(days=i * 7)
        week_start = week_end - timedelta(days=7)

        week_query = select(
            func.count(Outfit.id).label("total"),
            func.sum(case((Outfit.status == OutfitStatus.accepted, 1), else_=0)).label("accepted"),
            func.sum(case((Outfit.status == OutfitStatus.rejected, 1), else_=0)).label("rejected"),
        ).where(
            and_(
                Outfit.user_id == current_user.id,
                Outfit.created_at >= week_start,
                Outfit.created_at < week_end,
            )
        )

        week_result = await db.execute(week_query)
        week_row = week_result.one()

        week_total = week_row.total or 0
        week_accepted = week_row.accepted or 0
        week_rejected = week_row.rejected or 0
        week_responded = week_accepted + week_rejected

        acceptance_trend.append(
            AcceptanceRateTrend(
                period=week_start.strftime("%b %d"),
                total=week_total,
                accepted=week_accepted,
                rejected=week_rejected,
                rate=round(week_accepted / week_responded * 100, 1) if week_responded > 0 else 0,
            )
        )

    acceptance_trend.reverse()  # Oldest first

    # === Generate Insights ===
    insights = []

    if total_items == 0:
        insights.append("衣橱还是空的，先添加一些衣物开始吧！")
    else:
        # Wardrobe insights
        if len(never_worn) > 0:
            insights.append(f"你有 {len(never_worn)} 件从未穿过的衣物，试试给它们搭配一下吧！")

        # Color insights
        if color_distribution:
            top_color_en = color_distribution[0].color
            top_color = COLOR_CN.get(top_color_en, top_color_en)
            if color_distribution[0].percentage > 40:
                insights.append(
                    f"你的衣橱中 {top_color} 占比 {color_distribution[0].percentage}%，可以考虑添置一些其他颜色的单品。"
                )
            elif len(color_distribution) <= 3 and ready_items > 10:
                insights.append("你的衣橱颜色种类偏少，可以尝试添加一些新颜色的衣物！")

        # Type insights
        if type_distribution:
            tops = sum(
                t.count
                for t in type_distribution
                if t.type in ["shirt", "blouse", "t-shirt", "top"]
            )
            bottoms = sum(
                t.count
                for t in type_distribution
                if t.type in ["pants", "jeans", "skirt", "shorts"]
            )
            if tops > 0 and bottoms > 0:
                ratio = tops / bottoms
                if ratio > 3:
                    insights.append("上装远多于下装，建议添置几条裤子或裙子。")
                elif ratio < 0.5:
                    insights.append("下装多于上装，可以考虑添加一些上衣。")

        # Outfit insights
        if acceptance_rate is not None:
            if acceptance_rate > 80:
                insights.append(f"品味不错！你采纳了 {acceptance_rate:.0f}% 的搭配推荐。")
            elif acceptance_rate < 50:
                insights.append("你拒绝了较多推荐，可以尝试更新风格偏好来获得更精准的搭配。")

        if outfits_this_week == 0 and total_outfits > 0:
            insights.append("本周还没有搭配记录，试试去获取今日穿搭推荐吧！")

    return AnalyticsResponse(
        wardrobe=wardrobe_stats,
        color_distribution=color_distribution,
        type_distribution=type_distribution,
        most_worn=most_worn,
        least_worn=least_worn,
        never_worn=never_worn,
        acceptance_trend=acceptance_trend,
        insights=insights,
    )
