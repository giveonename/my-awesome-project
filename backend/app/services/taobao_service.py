"""Taobao Union (Taobao客) API service for product search."""

import hashlib
import logging
import time
from dataclasses import dataclass

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

TAOBAO_API_URL = "https://eco.taobao.com/router/rest"

# Structured mock product data for development/testing
# Each product has: keywords (multiple), formality, gender, category
_MOCK_PRODUCTS = [
    # ===== 下装 (Bottom) =====
    {
        "title": "修身西裤男直筒商务正装长裤",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i1/2206686532204/O1CN01JQZ4v31V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "299.00",
        "zk_final_price": "159.00",
        "volume": "5600",
        "shop_title": "西裤旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000001",
        "category_name": "西裤",
        "keywords": ["西裤", "西装裤", "直筒裤", "商务裤"],
        "formality": "formal",
        "gender": "male",
    },
    {
        "title": "春秋新款休闲裤男宽松直筒",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i2/2206686532204/O1CN01abc1231V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "189.00",
        "zk_final_price": "89.00",
        "volume": "12000",
        "shop_title": "休闲裤专营",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000002",
        "category_name": "休闲裤",
        "keywords": ["休闲裤", "宽松裤", "直筒裤"],
        "formality": "casual",
        "gender": "male",
    },
    {
        "title": "经典水洗牛仔裤男修身小脚",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i3/2206686532204/O1CN01def4561V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "259.00",
        "zk_final_price": "129.00",
        "volume": "18000",
        "shop_title": "牛仔裤专营店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000003",
        "category_name": "牛仔裤",
        "keywords": ["牛仔裤", "修身裤", "小脚裤"],
        "formality": "casual",
        "gender": "male",
    },
    {
        "title": "高腰阔腿裤女垂感显瘦",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i4/2206686532204/O1CN01ghi7891V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "239.00",
        "zk_final_price": "119.00",
        "volume": "9500",
        "shop_title": "女装裤业",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000004",
        "category_name": "阔腿裤",
        "keywords": ["阔腿裤", "高腰裤", "垂感裤"],
        "formality": "casual",
        "gender": "female",
    },
    {
        "title": "半身裙女高腰A字百褶裙",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i5/2206686532204/O1CN01jkl0121V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "199.00",
        "zk_final_price": "99.00",
        "volume": "7200",
        "shop_title": "裙装精品店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000005",
        "category_name": "半身裙",
        "keywords": ["半身裙", "百褶裙", "A字裙"],
        "formality": "casual",
        "gender": "female",
    },
    {
        "title": "男士夏季薄款短裤五分裤",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i6/2206686532204/O1CN01mno3451V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "139.00",
        "zk_final_price": "69.00",
        "volume": "22000",
        "shop_title": "短裤旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000006",
        "category_name": "短裤",
        "keywords": ["短裤", "五分裤", "夏季裤"],
        "formality": "casual",
        "gender": "male",
    },
    {
        "title": "直筒牛仔裤女复古高腰显瘦",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i6/2206686532204/O1CN01mno3451V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "219.00",
        "zk_final_price": "109.00",
        "volume": "15000",
        "shop_title": "牛仔裤女装",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000029",
        "category_name": "牛仔裤",
        "keywords": ["牛仔裤", "直筒裤", "高腰裤", "复古"],
        "formality": "casual",
        "gender": "female",
    },
    # ===== 上装 (Top) =====
    {
        "title": "商务正装衬衫男修身免烫",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i7/2206686532204/O1CN01pqr6781V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "259.00",
        "zk_final_price": "139.00",
        "volume": "8800",
        "shop_title": "衬衫旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000007",
        "category_name": "衬衫",
        "keywords": ["衬衫", "商务衬衫", "正装衬衫"],
        "formality": "formal",
        "gender": "male",
    },
    {
        "title": "纯棉圆领T恤男简约百搭",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i8/2206686532204/O1CN01stu9011V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "129.00",
        "zk_final_price": "59.00",
        "volume": "35000",
        "shop_title": "基础款旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000008",
        "category_name": "T恤",
        "keywords": ["T恤", "圆领", "纯棉", "百搭"],
        "formality": "casual",
        "gender": "male",
    },
    {
        "title": "男士连帽卫衣加绒加厚",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i9/2206686532204/O1CN01vwx2341V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "239.00",
        "zk_final_price": "129.00",
        "volume": "15000",
        "shop_title": "卫衣专营",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000009",
        "category_name": "卫衣",
        "keywords": ["卫衣", "连帽衫", "加绒"],
        "formality": "casual",
        "gender": "male",
    },
    {
        "title": "雪纺衫女职业气质衬衣",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i10/2206686532204/O1CN01yza5671V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "199.00",
        "zk_final_price": "99.00",
        "volume": "6800",
        "shop_title": "女装衬衫店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000010",
        "category_name": "雪纺衫",
        "keywords": ["雪纺衫", "衬衫", "职业装"],
        "formality": "formal",
        "gender": "female",
    },
    {
        "title": "女士针织衫慵懒风宽松",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i11/2206686532204/O1CN01bcd8901V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "189.00",
        "zk_final_price": "89.00",
        "volume": "11000",
        "shop_title": "针织衫旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000011",
        "category_name": "针织衫",
        "keywords": ["针织衫", "毛衣", "慵懒风", "百搭"],
        "formality": "casual",
        "gender": "female",
    },
    {
        "title": "POLO衫男商务休闲翻领",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i12/2206686532204/O1CN01efg1231V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "179.00",
        "zk_final_price": "89.00",
        "volume": "9200",
        "shop_title": "POLO专营",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000012",
        "category_name": "POLO衫",
        "keywords": ["POLO衫", "翻领衫", "商务休闲"],
        "formality": "formal",
        "gender": "male",
    },
    {
        "title": "纯色圆领T恤女简约百搭基础款",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i8/2206686532204/O1CN01stu9011V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "99.00",
        "zk_final_price": "49.00",
        "volume": "42000",
        "shop_title": "基础款女装",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000030",
        "category_name": "T恤",
        "keywords": ["T恤", "纯色", "百搭", "基础款", "圆领"],
        "formality": "casual",
        "gender": "female",
    },
    {
        "title": "白色衬衫女宽松休闲百搭",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i7/2206686532204/O1CN01pqr6781V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "159.00",
        "zk_final_price": "79.00",
        "volume": "28000",
        "shop_title": "衬衫女装",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000031",
        "category_name": "衬衫",
        "keywords": ["衬衫", "白色", "百搭", "简约"],
        "formality": "casual",
        "gender": "female",
    },
    # ===== 鞋子 (Shoes) =====
    {
        "title": "小白鞋厚底增高休闲板鞋",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i17/2206686532204/O1CN01tuv6781V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "299.00",
        "zk_final_price": "149.00",
        "volume": "20000",
        "shop_title": "板鞋潮流店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000017",
        "category_name": "板鞋",
        "keywords": ["小白鞋", "板鞋", "增高鞋", "百搭"],
        "formality": "casual",
        "gender": "unisex",
    },
    {
        "title": "经典款帆布鞋男女同款",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i15/2206686532204/O1CN01nop0121V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "199.00",
        "zk_final_price": "99.00",
        "volume": "30000",
        "shop_title": "帆布鞋店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000015",
        "category_name": "帆布鞋",
        "keywords": ["帆布鞋", "板鞋", "休闲鞋", "百搭"],
        "formality": "casual",
        "gender": "unisex",
    },
    {
        "title": "透气网面跑步运动鞋男",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i14/2206686532204/O1CN01klm7891V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "399.00",
        "zk_final_price": "179.00",
        "volume": "25000",
        "shop_title": "运动鞋旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000014",
        "category_name": "运动鞋",
        "keywords": ["运动鞋", "跑步鞋", "透气鞋", "舒适"],
        "formality": "casual",
        "gender": "male",
    },
    {
        "title": "女士平底乐福鞋舒适百搭",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i16/2206686532204/O1CN01qrs3451V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "259.00",
        "zk_final_price": "129.00",
        "volume": "16000",
        "shop_title": "女鞋舒适店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000032",
        "category_name": "乐福鞋",
        "keywords": ["乐福鞋", "平底鞋", "百搭", "舒适"],
        "formality": "casual",
        "gender": "female",
    },
    {
        "title": "男士商务正装皮鞋德比鞋",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i13/2206686532204/O1CN01hij4561V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "459.00",
        "zk_final_price": "239.00",
        "volume": "4500",
        "shop_title": "皮鞋旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000013",
        "category_name": "皮鞋",
        "keywords": ["皮鞋", "德比鞋", "商务鞋"],
        "formality": "formal",
        "gender": "male",
    },
    # ===== 外套 (Outerwear) =====
    {
        "title": "薄款防晒外套女春秋季",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i20/2206686532204/O1CN01cde5671V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "199.00",
        "zk_final_price": "89.00",
        "volume": "14000",
        "shop_title": "外套旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000020",
        "category_name": "薄外套",
        "keywords": ["薄外套", "防晒衣", "春季外套", "百搭"],
        "formality": "casual",
        "gender": "female",
    },
    {
        "title": "男士春秋薄款夹克棒球服",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i19/2206686532204/O1CN01zab2341V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "329.00",
        "zk_final_price": "169.00",
        "volume": "8500",
        "shop_title": "夹克专营",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000019",
        "category_name": "夹克",
        "keywords": ["夹克", "棒球服", "外套", "百搭"],
        "formality": "casual",
        "gender": "male",
    },
    {
        "title": "商务西装外套男修身单西",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i18/2206686532204/O1CN01wxy9011V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "599.00",
        "zk_final_price": "299.00",
        "volume": "3800",
        "shop_title": "西装旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000018",
        "category_name": "西装外套",
        "keywords": ["西装外套", "单西", "商务外套"],
        "formality": "formal",
        "gender": "male",
    },
    {
        "title": "男士中长款风衣经典款",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i21/2206686532204/O1CN01fgh8901V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "699.00",
        "zk_final_price": "359.00",
        "volume": "3200",
        "shop_title": "风衣旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000021",
        "category_name": "风衣",
        "keywords": ["风衣", "大衣", "中长款外套"],
        "formality": "formal",
        "gender": "male",
    },
    {
        "title": "女士针织开衫薄款百搭",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i20/2206686532204/O1CN01cde5671V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "179.00",
        "zk_final_price": "89.00",
        "volume": "18000",
        "shop_title": "开衫旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000033",
        "category_name": "针织开衫",
        "keywords": ["针织开衫", "薄外套", "百搭", "简约"],
        "formality": "casual",
        "gender": "female",
    },
    # ===== 连衣裙 (Dress) =====
    {
        "title": "法式碎花连衣裙女夏季新款",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i22/2206686532204/O1CN01ijk1231V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "329.00",
        "zk_final_price": "168.00",
        "volume": "9800",
        "shop_title": "连衣裙精品店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000022",
        "category_name": "连衣裙",
        "keywords": ["连衣裙", "碎花裙", "法式裙"],
        "formality": "casual",
        "gender": "female",
    },
    {
        "title": "职业通勤连衣裙女修身显瘦",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i23/2206686532204/O1CN01lmn4561V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "299.00",
        "zk_final_price": "158.00",
        "volume": "6500",
        "shop_title": "职业女装",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000023",
        "category_name": "职业裙",
        "keywords": ["职业裙", "通勤裙", "连衣裙", "简约"],
        "formality": "formal",
        "gender": "female",
    },
    {
        "title": "纯色T恤连衣裙女宽松休闲",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i22/2206686532204/O1CN01ijk1231V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "159.00",
        "zk_final_price": "79.00",
        "volume": "22000",
        "shop_title": "连衣裙基础款",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000034",
        "category_name": "T恤裙",
        "keywords": ["连衣裙", "T恤裙", "纯色", "百搭", "休闲"],
        "formality": "casual",
        "gender": "female",
    },
    # ===== 配饰 (Accessories) =====
    {
        "title": "女士斜挎包小众设计单肩包",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i26/2206686532204/O1CN01tuv3451V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "399.00",
        "zk_final_price": "199.00",
        "volume": "7500",
        "shop_title": "设计师包店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000026",
        "category_name": "斜挎包",
        "keywords": ["斜挎包", "单肩包", "手提包", "百搭"],
        "formality": "casual",
        "gender": "female",
    },
    {
        "title": "男士双肩包大容量商务通勤",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i27/2206686532204/O1CN01wxy6781V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "299.00",
        "zk_final_price": "149.00",
        "volume": "12000",
        "shop_title": "背包旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000027",
        "category_name": "双肩包",
        "keywords": ["双肩包", "背包", "通勤包"],
        "formality": "casual",
        "gender": "male",
    },
    {
        "title": "男士真皮自动扣腰带",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i25/2206686532204/O1CN01rst0121V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "199.00",
        "zk_final_price": "99.00",
        "volume": "16000",
        "shop_title": "腰带专营",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000025",
        "category_name": "腰带",
        "keywords": ["腰带", "皮带", "自动扣"],
        "formality": "formal",
        "gender": "male",
    },
    {
        "title": "真丝小方巾女百搭配饰",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i28/2206686532204/O1CN01zab9011V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "159.00",
        "zk_final_price": "79.00",
        "volume": "5800",
        "shop_title": "丝巾精品店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000028",
        "category_name": "丝巾",
        "keywords": ["丝巾", "方巾", "围巾", "百搭"],
        "formality": "formal",
        "gender": "female",
    },
    {
        "title": "男士商务公文包真皮手提包",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i24/2206686532204/O1CN01opq7891V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "499.00",
        "zk_final_price": "259.00",
        "volume": "3500",
        "shop_title": "公文包旗舰店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000024",
        "category_name": "公文包",
        "keywords": ["公文包", "手提包", "商务包"],
        "formality": "formal",
        "gender": "male",
    },
    {
        "title": "简约帆布包女百搭通勤手提袋",
        "pic_url": "https://img.alicdn.com/bao/uploaded/i26/2206686532204/O1CN01tuv3451V9dkL8H8!!2206686532204.jpg",
        "reserve_price": "129.00",
        "zk_final_price": "59.00",
        "volume": "32000",
        "shop_title": "帆布包店",
        "item_url": "https://detail.tmall.com/item.htm?id=100000000035",
        "category_name": "帆布包",
        "keywords": ["帆布包", "手提袋", "百搭", "通勤", "休闲"],
        "formality": "casual",
        "gender": "female",
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


# Category-to-keywords mapping for mock matching
_MOCK_CAT_KEYWORDS = {
    "bottom": ["裤子", "西裤", "牛仔裤", "休闲裤", "短裤", "阔腿裤", "半身裙", "百褶裙", "裙"],
    "top": ["衬衫", "T恤", "卫衣", "针织衫", "雪纺衫", "POLO衫", "上衣", "毛衣"],
    "shoes": ["鞋", "皮鞋", "运动鞋", "板鞋", "帆布鞋", "高跟鞋", "小白鞋", "靴"],
    "outerwear": ["外套", "西装外套", "夹克", "风衣", "大衣", "薄外套", "开衫"],
    "dress": ["连衣裙", "碎花裙", "职业裙", "法式裙", "裙"],
    "accessories": [
        "包",
        "公文包",
        "斜挎包",
        "双肩包",
        "背包",
        "腰带",
        "皮带",
        "丝巾",
        "围巾",
        "帽子",
    ],
}


def _match_mock_products(keyword: str, page: int, page_size: int) -> list[ProductItem]:
    """Structured matching against mock products with scoring."""
    search_terms = keyword.split()

    scored = []
    for p in _MOCK_PRODUCTS:
        score = 0
        title = p.get("title", "")
        kws = p.get("keywords", [])
        cat_name = p.get("category_name", "")
        all_text = title + " " + " ".join(kws) + " " + cat_name

        # Keyword match: each matching term adds score
        for term in search_terms:
            if term in all_text:
                score += 3

        # Category keyword match (broader)
        for _cat, cat_kws in _MOCK_CAT_KEYWORDS.items():
            if any(kw in keyword for kw in cat_kws):
                if any(kw in all_text for kw in cat_kws):
                    score += 1
                    break

        if score > 0:
            scored.append((score, p))

    scored.sort(key=lambda x: x[0], reverse=True)
    matched = [p for _, p in scored]

    if not matched:
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
        return _match_mock_products(keyword, page, page_size)

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
        "need_free_shipment": "true",  # package邮
        "need_prepay": "true",  # consumer protection
        "include_good_rate": "true",  # high approval rate
        "sort": sort or "tk_total_sales",  # default: best selling
    }

    params["sign"] = _sign_request(params, settings.taobao_app_secret or "")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(TAOBAO_API_URL, params=params)
            data = resp.json()

        # Try upgrade response key first, fall back to legacy
        result = data.get("tbk_dg_material_optional_upgrade_response") or data.get(
            "tbk_dg_material_optional_response", {}
        )
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
            volume = str(
                basic.get("tk_total_sales") or basic.get("volume") or item.get("volume", 0)
            )
            shop_title = basic.get("shop_title") or item.get("shop_title", "")
            category_name = basic.get("category_name") or item.get("category_name", "")

            # Build click URL from publish_info
            click_url = publish.get("click_url", "")
            coupon_url = publish.get("coupon_share_url", "")
            item_url = coupon_url or click_url or ""
            # Ensure full URL
            if item_url and not item_url.startswith("http"):
                item_url = "https:" + item_url

            products.append(
                ProductItem(
                    title=title,
                    pic_url=pic_url,
                    price=price,
                    original_price=original_price,
                    volume=volume,
                    shop_title=shop_title,
                    item_url=item_url,
                    category_name=category_name,
                )
            )
        return products

    except Exception as e:
        logger.error("Taobao API search failed: %s", e)
        return []
