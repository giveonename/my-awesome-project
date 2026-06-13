// 衣物类型中文标签
export const TYPE_LABELS: Record<string, string> = {
  'shirt': '衬衫',
  't-shirt': 'T恤',
  'pants': '裤子',
  'jeans': '牛仔裤',
  'shorts': '短裤',
  'dress': '连衣裙',
  'skirt': '裙子',
  'jacket': '夹克',
  'coat': '外套',
  'sweater': '毛衣',
  'hoodie': '卫衣',
  'blazer': '西装外套',
  'shoes': '鞋子',
  'sneakers': '运动鞋',
  'boots': '靴子',
  'accessories': '配饰',
  'hat': '帽子',
  'bag': '包',
  'top': '上衣',
}

// Category filter mapping: category key → list of clothing types
export const CATEGORY_TYPES: Record<string, string[]> = {
  'top': ['shirt', 't-shirt', 'sweater', 'hoodie', 'blazer', 'jacket', 'coat', 'top'],
  'bottom': ['pants', 'jeans', 'shorts', 'skirt'],
  'shoes': ['shoes', 'sneakers', 'boots'],
  'accessories': ['accessories', 'hat', 'bag'],
}

// 材质英文→中文映射
export const MATERIAL_LABELS_CN: Record<string, string> = {
  'cotton': '棉',
  'denim': '牛仔布',
  'leather': '皮革',
  'wool': '羊毛',
  'polyester': '聚酯纤维',
  'silk': '丝绸',
  'linen': '亚麻',
  'knit': '针织',
  'fleece': '摇粒绒',
  'suede': '麂皮',
  'velvet': '天鹅绒',
  'nylon': '尼龙',
  'canvas': '帆布',
}

// 正式度英文→中文映射
export const FORMALITY_LABELS_CN: Record<string, string> = {
  'very-casual': '非常休闲',
  'casual': '休闲',
  'smart-casual': '商务休闲',
  'business-casual': '半正式',
  'formal': '正式',
}

// 风格英文→中文映射
export const STYLE_LABELS_CN: Record<string, string> = {
  'casual': '休闲',
  'classic': '经典',
  'sporty': '运动',
  'minimalist': '简约',
  'bohemian': '波西米亚',
  'preppy': '学院风',
  'streetwear': '街头',
  'elegant': '优雅',
  'athletic': '运动风',
  'vintage': '复古',
  'modern': '现代',
  'rugged': '硬朗',
}

// 季节英文→中文映射
export const SEASON_LABELS_CN: Record<string, string> = {
  'spring': '春季',
  'summer': '夏季',
  'fall': '秋季',
  'winter': '冬季',
  'all-season': '四季',
}

// 图案英文→中文映射
export const PATTERN_LABELS_CN: Record<string, string> = {
  'solid': '纯色',
  'striped': '条纹',
  'plaid': '格纹',
  'floral': '花卉',
  'polka-dot': '波点',
  'camo': '迷彩',
  'paisley': '佩斯利',
  'geometric': '几何',
  'abstract': '抽象',
  'leopard': '豹纹',
}

// 版型英文→中文映射
export const FIT_LABELS_CN: Record<string, string> = {
  'slim': '修身',
  'regular': '常规',
  'loose': '宽松',
  'oversized': 'Oversize',
  'relaxed': '休闲',
  'tight': '紧身',
  'tapered': '锥形',
  'straight': '直筒',
}

// 颜色英文→中文映射
export const COLOR_LABELS_CN: Record<string, string> = {
  'black': '黑色',
  'white': '白色',
  'gray': '灰色',
  'grey': '灰色',
  'navy': '藏青色',
  'blue': '蓝色',
  'light-blue': '浅蓝色',
  'red': '红色',
  'burgundy': '酒红色',
  'pink': '粉色',
  'green': '绿色',
  'olive': '橄榄绿',
  'yellow': '黄色',
  'orange': '橙色',
  'purple': '紫色',
  'brown': '棕色',
  'tan': '卡其色',
  'beige': '米色',
  'cream': '奶油色',
  'gold': '金色',
  'silver': '银色',
  'khaki': '卡其色',
  'maroon': '栗色',
  'teal': '青色',
  'cyan': '青色',
  'charcoal': '炭灰色',
  'wine': '酒红色',
}

// 天气状况英文→中文映射
export const WEATHER_CONDITION_CN: Record<string, string> = {
  'sunny': '晴',
  'mostly sunny': '晴间多云',
  'partly cloudy': '多云',
  'cloudy': '阴',
  'overcast': '阴',
  'foggy': '雾',
  'light drizzle': '小雨',
  'drizzle': '毛毛雨',
  'heavy drizzle': '中雨',
  'freezing drizzle': '冻雨',
  'light rain': '小雨',
  'rain': '中雨',
  'heavy rain': '大雨',
  'freezing rain': '冻雨',
  'light snow': '小雪',
  'snow': '中雪',
  'heavy snow': '大雪',
  'snow grains': '雪粒',
  'light showers': '小阵雨',
  'showers': '阵雨',
  'heavy showers': '大阵雨',
  'light snow showers': '小阵雪',
  'snow showers': '阵雪',
  'thunderstorm': '雷阵雨',
  'thunderstorm with hail': '雷阵雨伴有冰雹',
  'hot': '炎热',
  'cold': '寒冷',
  'unknown': '未知',
  'clear': '晴',
}

// 颜色名称 → CSS 色值映射
export const COLOR_MAP: Record<string, string> = {
  'black': '#000',
  'white': '#fff',
  'gray': '#808080',
  'grey': '#808080',
  'navy': '#001f3f',
  'blue': '#0074D9',
  'light-blue': '#5DADE2',
  'red': '#FF4136',
  'pink': '#FF69B4',
  'green': '#2ECC40',
  'yellow': '#FFDC00',
  'orange': '#FF851B',
  'purple': '#B10DC9',
  'brown': '#8B4513',
  'beige': '#F5F5DC',
  'cream': '#FFFDD0',
  'khaki': '#F0E68C',
  'olive': '#808000',
  'teal': '#008080',
  'maroon': '#800000',
  'cyan': '#00FFFF',
  'gold': '#FFD700',
  'silver': '#C0C0C0',
  'charcoal': '#36454F',
  'wine': '#722F37',
  'burgundy': '#800020',
}

// ===== 文本净化工具 =====

const DIRTY_VALUES = new Set(['unknown', 'null', 'undefined', 'none', ''])

/**
 * 净化显示文本：过滤后端返回的脏数据（如 "unknown"）
 * @param value 原始值
 * @param fallback 兜底文本，默认为空字符串
 * @returns 净化后的文本
 */
export function sanitizeDisplay(value: string | null | undefined, fallback: string = ''): string {
  if (!value) return fallback
  const lower = value.toLowerCase().trim()
  if (DIRTY_VALUES.has(lower)) return fallback
  return value
}

/**
 * 获取衣物显示名称：优先 name → TYPE_LABELS → type → 兜底
 */
export function getItemDisplayName(name: string | null | undefined, type: string | null | undefined): string {
  const cleanName = sanitizeDisplay(name)
  if (cleanName) return cleanName
  const cleanType = sanitizeDisplay(type)
  if (cleanType && TYPE_LABELS[cleanType]) return TYPE_LABELS[cleanType]
  if (cleanType) return cleanType
  return '未命名单品'
}

/**
 * 获取衣物类型标签
 */
export function getTypeLabel(type: string | null | undefined): string {
  const cleanType = sanitizeDisplay(type)
  if (cleanType && TYPE_LABELS[cleanType]) return TYPE_LABELS[cleanType]
  return cleanType || '其他'
}

// 场合标签（统一定义，所有页面共用）
export const OCCASION_LABELS: Record<string, string> = {
  casual: '日常',
  work: '通勤',
  date: '约会',
  formal: '正式',
  sport: '运动',
  travel: '旅行',
  party: '派对',
  office: '办公',
  outdoor: '户外',
  lounge: '居家',
  beach: '海滩',
}

export const OCCASION_ICONS: Record<string, string> = {
  casual: '☀️',
  work: '💼',
  date: '💕',
  formal: '👔',
  sport: '🏃',
  travel: '✈️',
  party: '🎉',
  outdoor: '🏕️',
}

// 用于筛选栏（带"全部"选项）
export const OCCASION_FILTERS = [
  { key: 'all', label: '全部' },
  ...Object.entries(OCCASION_LABELS)
    .filter(([k]) => ['casual', 'work', 'date', 'formal', 'sport', 'travel', 'party'].includes(k))
    .map(([key, label]) => ({ key, label })),
]

// 用于场景选择面板（不含"全部"）
export const OCCASION_OPTIONS = Object.entries(OCCASION_LABELS)
  .filter(([k]) => ['casual', 'work', 'date', 'formal', 'sport', 'travel', 'party'].includes(k))
  .map(([key, label]) => ({ key, label, icon: OCCASION_ICONS[key] || '🏷️' }))