"""Taobao Union (Taobao客) API service for product search."""

import hashlib
import json
import logging
import time
from dataclasses import dataclass

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

TAOBAO_API_URL = "https://eco.taobao.com/router/rest"

# Mock product data for development/testing
_MOCK_PRODUCTS = [
    {
        "title": "春季薄款轻薄外套女防晒衣",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i1/2206686532204/O1CN01JQZ4v31V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "199.00",
        "zk_final_price": "89.00",
        "volume": "3258",
        "nick": "时尚女装旗舰店",
        "shop_title": "时尚女装旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=000000000000",
        "category_name": "外套",
        "keyword": "薄外套",
    },
    {
        "title": "休闲运动鞋女透气网面跑步鞋",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i2/2206686532204/O1CN01abc1231V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "399.00",
        "zk_final_price": "159.00",
        "volume": "11200",
        "nick": "运动鞋旗舰店",
        "shop_title": "运动鞋旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=000000000001",
        "category_name": "运动鞋",
        "keyword": "运动鞋",
    },
    {
        "title": "高腰直筒牛仔裤女显瘦百搭",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i3/2206686532204/O1CN01def4561V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "259.00",
        "zk_final_price": "129.00",
        "volume": "8900",
        "nick": "牛仔裤专营店",
        "shop_title": "牛仔裤专营店",
        "item_url": "https://detail.tmall.com/item.htm?id=000000000002",
        "category_name": "牛仔裤",
        "keyword": "牛仔裤",
    },
    {
        "title": "法式碎花连衣裙女夏季新款",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i4/2206686532204/O1CN01ghi7891V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "329.00",
        "zk_final_price": "168.00",
        "volume": "5600",
        "nick": "连衣裙精品店",
        "shop_title": "连衣裙精品店",
        "item_url": "https://detail.tmall.com/item.htm?id=000000000003",
        "category_name": "连衣裙",
        "keyword": "连衣裙",
    },
    {
        "title": "简约纯棉圆领T恤女宽松版",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i5/2206686532204/O1CN01jkl0121V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "129.00",
        "zk_final_price": "59.00",
        "volume": "25600",
        "nick": "基础款旗舰店",
        "shop_title": "基础款旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=000000000004",
        "category_name": "T恤",
        "keyword": "T恤",
    },
    {
        "title": "小众设计手提斜挎包女包",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i6/2206686532204/O1CN01mno3451V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "459.00",
        "zk_final_price": "239.00",
        "volume": "4200",
        "nick": "女包设计师店",
        "shop_title": "女包设计师店",
        "item_url": "https://detail.tmall.com/item.htm?id=000000000005",
        "category_name": "包",
        "keyword": "女包",
    },
    {
        "title": "春秋薄款针织开衫女百搭",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i7/2206686532204/O1CN01pqr6781V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "189.00",
        "zk_final_price": "99.00",
        "volume": "7800",
        "nick": "针织衫旗舰店",
        "shop_title": "针织衫旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=000000000006",
        "category_name": "开衫",
        "keyword": "针织开衫",
    },
    {
        "title": "小白鞋女厚底增高休闲板鞋",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i8/2206686532204/O1CN01stu9011V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "359.00",
        "zk_final_price": "179.00",
        "volume": "15000",
        "nick": "板鞋潮流店",
        "shop_title": "板鞋潮流店",
        "item_url": "https://detail.tmall.com/item.htm?id=000000000007",
        "category_name": "板鞋",
        "keyword": "小白鞋",
    },
]


@dataclass
class ProductItem:
    """A product from Taobao search results."""
    title: str
    pic_url: str
    price: str
    original_price: str
    volume: str
    shop_title: str
    item_url: str
    category_name: str


def _is_mock_mode() -> bool:
    """Check if we should use mock data."""
    settings = get_settings()
    return not settings.taobao_app_key


def _sign_request(params: dict, app_secret: str) -> str:
    """Generate Taobao API sign for a request."""
    sorted_params = sorted(params.items())
    sign_str = app_secret + "".join(f"{k}{v}" for k, v in sorted_params) + app_secret
    return hashlib.md5(sign_str.encode("utf-8")).hexdigest().upper()


async def search_products(
    keyword: str,
    page: int = 1,
    page_size: int = 20,
    sort: str = "tk_rate_des",
) -> list[ProductItem]:
    """Search Taobao products by keyword.

    Args:
        keyword: Search keyword (e.g. "薄外套", "运动鞋")
        page: Page number (1-based)
        page_size: Results per page (max 100)
        sort: Sort order (tk_rate_des, tk_total_sales_des, price_asc, etc.)

    Returns:
        List of ProductItem results
    """
    settings = get_settings()

    if _is_mock_mode():
        logger.info("Taobao API in MOCK mode, returning mock data for: %s", keyword)
        # Filter mock data by keyword match
        matched = [p for p in _MOCK_PRODUCTS if keyword in p.get("keyword", "") or keyword in p.get("category_name", "")]
        if not matched:
            # Return all mock products if no keyword match
            matched = _MOCK_PRODUCTS
        # Simulate pagination
        start = (page - 1) * page_size
        end = start + page_size
        page_items = matched[start:end]

        return [
            ProductItem(
                title=p["title"],
                pic_url=p["pic_url"],
                price=p["zk_final_price"],
                original_price=p["reserve_price"],
                volume=p["volume"],
                shop_title=p["shop_title"],
                item_url=p["item_url"],
                category_name=p["category_name"],
            )
            for p in page_items
        ]

    # Real Taobao API call
    # material_id=17004: official personalized search (clothing optimized)
    # material_id=80309: default fallback
    params = {
        "method": "taobao.tbk.dg.material.optional.upgrade",
        "app_key": settings.taobao_app_key,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "format": "json",
        "v": "2.0",
        "sign_method": "md5",
        "q": keyword,
        "page_no": str(page),
        "page_size": str(page_size),
        "material_id": str(settings.taobao_material_id or 17004),
        "adzone_id": settings.taobao_adzone_id or "",
        # Filters for quality results
        "need_free_shipment": "true",       # package邮
        "need_prepay": "true",              # consumer protection
        "include_good_rate": "true",        # high approval rate
        "sort": sort or "tk_total_sales",   # default: best selling
    }

    params["sign"] = _sign_request(params, settings.taobao_app_secret or "")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(TAOBAO_API_URL, params=params)
            data = resp.json()

        # Try upgrade response key first, fall back to legacy
        result = data.get("tbk_dg_material_optional_upgrade_response") or                  data.get("tbk_dg_material_optional_response", {})
        result_data = result.get("result_list", {}).get("map_data", [])

        products = []
        for item in result_data:
            # New upgrade API nests data in sub-objects
            basic = item.get("item_basic_info", {})
            price_info = item.get("price_promotion_info", {})
            publish = item.get("publish_info", {})

            # Extract fields from nested or flat structure
            title = basic.get("title") or item.get("title", "")
            pic_url = basic.get("pict_url") or item.get("pict_url", "")
            price = price_info.get("zk_final_price") or item.get("zk_final_price", "0")
            original_price = price_info.get("reserve_price") or item.get("reserve_price", "0")
            volume = str(basic.get("tk_total_sales") or basic.get("volume") or item.get("volume", 0))
            shop_title = basic.get("shop_title") or item.get("shop_title", "")
            category_name = basic.get("category_name") or item.get("category_name", "")

            # Build click URL from publish_info
            click_url = publish.get("click_url", "")
            coupon_url = publish.get("coupon_share_url", "")
            item_url = coupon_url or click_url or ""
            # Ensure full URL
            if item_url and not item_url.startswith("http"):
                item_url = "https:" + item_url

            products.append(ProductItem(
                title=title,
                pic_url=pic_url,
                price=price,
                original_price=original_price,
                volume=volume,
                shop_title=shop_title,
                item_url=item_url,
                category_name=category_name,
            ))
        return products

    except Exception as e:
        logger.error("Taobao API search failed: %s", e)
        return []
