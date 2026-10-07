# Wardrowbe 微信小程序 — "搭搭"风格仿制设计说明书

> 本文档基于"搭搭"App截图逆向分析，为 Wardrowbe 微信小程序提供完整的仿制设计方案。
> 技术栈：Taro 4.2 + React 18 + TypeScript + SCSS

---

## 一、设计系统（Design Tokens）

### 1.1 色彩体系

```scss
// ===== 主色调（2026-10 换色：深墨绿 + 奶油白，画廊式衬托衣物照片） =====
$color-primary: #2D6A4F;           // 深墨绿（按钮/标签/选中态）
$color-primary-light: #5E9C82;     // 浅鼠尾草绿
$color-primary-dark: #1B4D3E;      // 深松绿（按压态）
$color-accent-gold: #C2A878;       // 米金点缀（克制使用）
$color-accent-gradient: #2D6A4F;   // 实色，去掉渐变

// ===== 背景 =====
$bg-home-gradient: #FAF7F2;        // 奶油白（暖）
$bg-profile-gradient: #FAF7F2;
$bg-page-default: #FAF7F2;

// ===== 卡片 =====
$card-bg: #FFFFFF;
$card-shadow: 0 4px 20px rgba(91, 79, 196, 0.08);
$card-shadow-hover: 0 6px 24px rgba(91, 79, 196, 0.12);
$card-border-radius: 24rpx;
$card-inner-border-radius: 20rpx;

// ===== 文字 =====
$text-primary: #1A1A2E;            // 主文字
$text-secondary: #6B6B80;          // 副文字
$text-tertiary: #9E9EB8;           // 辅助文字
$text-on-primary: #FFFFFF;          // 主色上的文字

// ===== 功能色 =====
$color-success: #2ECC71;
$color-warning: #F39C12;
$color-danger: #E74C3C;
$color-ai-glow: rgba(108, 92, 231, 0.3);  // AI光效

// ===== 标签/徽章 =====
$tag-ai-bg: linear-gradient(135deg, #6C5CE7, #A29BFE);
$tag-vip-bg: linear-gradient(135deg, #1A1A2E, #2D2D44);
$tag-badge-red: #FF4757;
```

### 1.2 圆角体系

| 元素 | 圆角 | 说明 |
|------|------|------|
| 大卡片 | 24rpx | 首页区块、搭配卡片 |
| 中卡片 | 20rpx | 功能入口卡片 |
| 小卡片/标签 | 12rpx | 衣物标签、筛选Tag |
| 胶囊按钮 | 40rpx | 主操作按钮、筛选器 |
| 弹窗 | 28rpx | 底部弹窗、模态框 |
| 头像 | 50% | 正圆形 |
| 悬浮按钮 | 50% | 中间"+"按钮 |
| 图标容器 | 16rpx | 功能图标背景框 |

### 1.3 间距体系（rpx）

| 间距 | 值 | 用途 |
|------|-----|------|
| xs | 8rpx | 紧凑元素间 |
| sm | 16rpx | 列表项间距 |
| md | 24rpx | 卡片间距、内边距 |
| lg | 32rpx | 区块间距 |
| xl | 48rpx | 页面顶部留白 |

### 1.4 字体层级

| 层级 | 大小 | 粗细 | 行高 | 用途 |
|------|------|------|------|------|
| H1 | 44rpx | 700 | 1.3 | 页面标题 |
| H2 | 36rpx | 700 | 1.3 | 区块标题 |
| H3 | 32rpx | 600 | 1.4 | 卡片标题 |
| Body | 28rpx | 400 | 1.5 | 正文 |
| Body-Small | 26rpx | 400 | 1.5 | 列表副标题 |
| Caption | 24rpx | 400 | 1.4 | 辅助说明 |
| Tag | 22rpx | 500 | 1.0 | 标签文字 |

---

## 二、TabBar 设计

### 2.1 结构

```
┌────────┬────────┬────────┬────────┬────────┐
│  衣橱  │  搭配  │  [➕]  │  发现  │  我的  │
│ (icon) │ (icon) │ (悬浮) │ (icon) │ (icon) │
└────────┴────────┴────────┴────────┴────────┘
```

- 4个Tab + 1个中间悬浮按钮
- Tab高度：100rpx（不含安全区）
- 悬浮按钮直径：108rpx，位于TabBar上方16rpx
- 悬浮按钮背景：`#2D6A4F`（实色）
- 悬浮按钮投影：`0 4px 16px rgba(45, 106, 79, 0.35)`

### 2.2 Tab图标规格

| Tab | 未选中色 | 选中色 | 图标尺寸 |
|-----|---------|--------|---------|
| 首页 | #8F8B84 | #2D6A4F | 48rpx |
| 衣橱 | #8F8B84 | #2D6A4F | 48rpx |
| 搭配 | #8F8B84 | #2D6A4F | 48rpx |
| 我的 | #8F8B84 | #2D6A4F | 48rpx |

- 图标风格：手绘线条风（line icons），非填充
- Tab文字大小：20rpx
- 选中态：图标+文字均为 `$color-primary`
- 未选中态：图标+文字均为 `$text-tertiary`

### 2.3 悬浮"+"按钮交互

- 点击后弹出底部操作面板（ActionSheet）
- 选项：📷 拍照上传 / 🖼️ 从相册选择 / 📋 AI批量解析
- 面板动画：从底部滑入，背景遮罩淡入

---

## 三、各页面组件拆解

### 3.1 首页（Home）

#### 页面结构（从上到下）

```
┌─────────────────────────────────┐
│  ☁️ 贵阳市  阴  20/27°C     💬 │  ← 天气信息条 + 消息入口
├─────────────────────────────────┤
│ ┌───────────┐ ┌───────────────┐│
│ │ 我的衣橱  │ │  今日穿搭     ││  ← 三入口卡片区
│ │           │ │  记录今日穿搭  ││
│ │ [上传衣服] │ └───────────────┘│
│ └───────────┘ ┌───────────────┐│
│               │  搭配DIY      ││
│               │  搭出创意好品味 ││
│               └───────────────┘│
├─────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│ │AI  │ │帮我│ │搭配│ │穿搭│   │  ← 功能图标网格（2行4列）
│ │搭配│ │搭配│ │DIY │ │日记│   │
│ └────┘ └────┘ └────┘ └────┘   │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│ │穿搭│ │拍照│ │邀请│ │会员│   │
│ │评测│ │搜搭│ │有礼│ │中心│   │
│ └────┘ └────┘ └────┘ └────┘   │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐│
│ │  Banner轮播图（活动推广）    ││
│ └─────────────────────────────┘│
├─────────────────────────────────┤
│  帮Ta搭配                    更多>│
│ ┌─────────────────────────────┐│
│ │ 用户需求 + AI/用户推荐方案  ││  ← 社交预览区
│ └─────────────────────────────┘│
└─────────────────────────────────┘
```

#### 组件拆解

**A. 天气信息条**
| 属性 | 值 |
|------|-----|
| 背景 | 透明（融入渐变背景） |
| 高度 | 80rpx |
| 内边距 | 上下 16rpx，左右 32rpx |
| 布局 | Flex row，space-between |
| 左侧 | 天气图标(emoji/SVG) + 城市名 + 天气 + 温度 |
| 右侧 | 消息图标（圆形，40rpx） |
| 字体 | Caption 24rpx，颜色 $text-secondary |

**B. 三入口卡片区**
| 属性 | 值 |
|------|-----|
| 布局 | 两列不等高Grid |
| 左列 | 大卡片（占50%宽度），高约320rpx |
| 右列 | 两个小卡片堆叠，各占50%宽度 |
| 卡片间距 | 16rpx |
| 卡片圆角 | 24rpx |
| 卡片背景 | 白色，box-shadow: $card-shadow |
| 卡片内边距 | 28rpx |

| 子卡片 | 内容 | 特殊样式 |
|--------|------|---------|
| 我的衣橱 | 标题 + 衣柜插图 + 描述 + 上传按钮 | 按钮：紫色渐变胶囊形 |
| 今日穿搭 | 标题 + 描述 + 穿搭插图 | 浅灰背景 |
| 搭配DIY | 标题 + 描述 + 手机插图 | 浅灰背景 |

**C. 功能图标网格**
| 属性 | 值 |
|------|-----|
| 布局 | 4列2行Grid |
| 每项 | 图标容器(64rpx) + 标题文字(24rpx) |
| 图标容器 | 64rpx × 64rpx，圆角16rpx |
| 图标背景 | 白色 + 浅紫边框 |
| 图标内容 | 手绘线条风格SVG |
| 标题颜色 | $text-primary |
| 标题大小 | 24rpx，居中 |
| 行间距 | 32rpx |
| 列间距 | 0（平均分布） |
| 特殊标记 | "AI搭配"左上角有红色"推荐"徽章 |

**D. 功能图标详情**

| 图标 | 标题 | 图标描述 | 点击行为 |
|------|------|---------|---------|
| 🔵 AI搭配 | AI搭配 | 衣服+AI光效 | → suggest页 |
| 👥 帮我搭配 | 帮我搭配 | 人物+衣服 | → 社区页（新增） |
| ✋ 搭配DIY | 搭配DIY | 手指触碰衣服 | → DIY页（新增） |
| 📅 穿搭日记 | 穿搭日记 | 日历+衣服 | → history页 |
| ✏️ 穿搭评测 | 穿搭评测 | 画笔+衣服 | → 新页面 |
| 🔍 拍照搜搭配 | 拍照搜搭配 | 搜索+衣服 | → 拍照搜索 |
| 👥 邀请有礼 | 邀请有礼 | 人物+礼物 | → 邀请页 |
| 👑 会员中心 | 会员中心 | SVIP徽章 | → 会员页 |

**E. Banner轮播**
| 属性 | 值 |
|------|-----|
| 高度 | 240rpx |
| 圆角 | 24rpx |
| 外边距 | 左右32rpx |
| 指示器 | 底部小圆点，选中态拉长为胶囊 |
| 自动轮播 | 3秒间隔 |

**F. 帮Ta搭配预览**
| 属性 | 值 |
|------|-----|
| 标题行 | 左：标题文字(32rpx/700)，右："更多>"链接 |
| 卡片高度 | 约300rpx |
| 内容 | 用户头像 + 昵称 + 需求文字 + 衣物缩略图 + AI推荐方案缩略图 |

---

### 3.2 搭配页（Suggest）

#### 页面结构

```
┌─────────────────────────────────┐
│  我的搭配    AI搭配    商品搭配  │  ← 顶部Tab切换
├─────────────────────────────────┤
│  上传衣服后，才能为你生成AI搭配   │
│        ┌─────────────┐          │  ← 空状态
│        │  立即上传    │          │
│        └─────────────┘          │
├─────────────────────────────────┤
│  看看别人的AI搭配               │
│ ┌─────────────────────────────┐│
│ │ ┌────────┐ ┌──────────────┐ ││
│ │ │衣物网格│ │  模特穿搭照  │ ││  ← AI搭配卡片
│ │ │ 2×2    │ │              │ ││
│ │ │        │ │              │ ││
│ │ └────────┘ └──────────────┘ ││
│ │  AI              ❤️ 20      ││
│ └─────────────────────────────┘│
│ ┌─────────────────────────────┐│
│ │  ... 更多搭配卡片 ...        ││
│ └─────────────────────────────┘│
└─────────────────────────────────┘
```

#### 核心组件：AI搭配卡片

**尺寸与布局：**
| 属性 | 值 |
|------|-----|
| 卡片宽度 | 屏幕宽度 - 64rpx（左右各32rpx） |
| 卡片高度 | 约500rpx |
| 圆角 | 24rpx |
| 背景 | 白色 |
| 阴影 | $card-shadow |
| 内部布局 | 左右50%/50% |

**左侧：衣物平铺区**
| 属性 | 值 |
|------|-----|
| 背景 | #F8F8FA（浅灰） |
| 圆角 | 左上+左下 24rpx |
| 布局 | 2×2 Grid，间距8rpx |
| 每个单品图 | 正方形，object-fit: contain |
| 底部标签 | "AI"文字，紫色渐变背景，圆角12rpx |

**右侧：穿搭效果区**
| 属性 | 值 |
|------|-----|
| 图片 | object-fit: cover，填满区域 |
| 圆角 | 右上+右下 24rpx |
| 右下角 | 点赞数徽章（❤️ 20），白色半透明背景 |

**底部信息栏**
| 属性 | 值 |
|------|-----|
| 高度 | 56rpx |
| 左侧 | "AI"标签（紫色渐变，圆角12rpx，字体20rpx白色） |
| 右侧 | 点赞图标 + 数字（24rpx，$text-secondary） |

#### 交互逻辑

| 操作 | 行为 |
|------|------|
| 点击卡片 | 展开详情页（显示搭配方案完整信息） |
| 点击左侧单品 | 跳转衣物详情页 |
| 点击点赞 | 切换点赞状态，数字+1/-1 |
| 点击Tab切换 | 切换内容列表（我的搭配/AI搭配/商品搭配） |
| 下拉刷新 | 重新加载搭配列表 |
| 上拉加载 | 加载更多搭配 |

---

### 3.3 个人中心（Profile）

#### 页面结构

```
┌─────────────────────────────────┐
│      ╭─────────────────────╮    │
│      │  🟣渐变背景          │    │
│      │  ┌───┐              │    │
│      │  │头像│  昵称        │    │
│      │  │120│  0粉丝 0关注 │    │
│      │  └───┘  0获赞       │    │
│      ╰─────────────────────╯    │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐│
│ │ 💎 搭搭邀请您成为会员       ││  ← 会员推广横幅
│ │    更多会员权益等你开启      ││
│ │              [了解会员]      ││
│ └─────────────────────────────┘│
├─────────────────────────────────┤
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐    │
│ │动态│ │收藏│ │相册│ │身材│ │点赞│   │  ← 功能图标行
│ └──┘ └──┘ └──┘ └──┘ └──┘    │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐│
│ │ 💬 我的消息              >  ││
│ │ ─────────────────────────── ││  ← 菜单分组1
│ │ 🎫 我的券包              >  ││
│ └─────────────────────────────┘│
│ ┌─────────────────────────────┐│
│ │ 📝 意见反馈              >  ││
│ │ ─────────────────────────── ││  ← 菜单分组2
│ │ ❓ 常见问题              >  ││
│ │ ─────────────────────────── ││
│ │ 👥 邀请有礼              >  ││
│ └─────────────────────────────┘│
│ ┌─────────────────────────────┐│
│ │ ⚙️ 系统设置              >  ││  ← 菜单分组3
│ └─────────────────────────────┘│
└─────────────────────────────────┘
```

#### 组件拆解

**A. 用户信息头部**
| 属性 | 值 |
|------|-----|
| 背景 | linear-gradient(180deg, #EDE0F5, #D8E8F0) |
| 圆角 | 底部32rpx（只圆底部） |
| 内边距 | 80rpx(上) 32rpx(下) 40rpx(左右) |
| 头像 | 120rpx × 120rpx，圆形，白色3rpx边框 |
| 昵称 | 36rpx/700，$text-primary |
| 数据行 | 粉丝/关注/获赞，24rpx，$text-secondary，间距24rpx |

**B. 会员推广横幅**
| 属性 | 值 |
|------|-----|
| 背景 | linear-gradient(135deg, #1A1A2E, #2D2D44) |
| 圆角 | 24rpx |
| 外边距 | 左右32rpx，上24rpx |
| 高度 | 120rpx |
| 左侧 | 💎 钻石图标（大，彩色渐变） |
| 中间 | 标题 + 副标题（白色文字） |
| 右侧 | "了解会员"按钮，圆角胶囊形，白色边框+白色文字 |

**C. 功能图标行**
| 属性 | 值 |
|------|-----|
| 布局 | Flex row，5等分 |
| 每项 | 图标(48rpx) + 标题(22rpx) |
| 图标 | 手绘线条风格，48rpx |
| 标题 | 22rpx，$text-secondary |
| 上下内边距 | 32rpx |
| 背景 | 白色卡片，圆角24rpx |

**D. 菜单项**
| 属性 | 值 |
|------|-----|
| 高度 | 96rpx |
| 内边距 | 0 32rpx |
| 布局 | Flex row，左中右 |
| 左侧 | 图标(36rpx) + 标题(28rpx) |
| 右侧 | 箭头">"(24rpx，$text-tertiary) |
| 分割线 | 左侧72rpx偏移，1rpx高，#F0F0F5 |
| 背景 | 白色卡片，圆角24rpx |

---

### 3.4 衣橱页（Wardrobe）

#### 页面结构

```
┌─────────────────────────────────┐
│  我的衣橱 >              🔽筛选│  ← 标题 + 筛选入口
├─────────────────────────────────┤
│  🕐 衣橱统计   ⚙ 衣橱设置 NEW  │  ← 功能栏
│           🔄 排序展示            │
├─────────────────────────────────┤
│  👕 上衣                        │
│ ┌────┐ ┌────┐ ┌────┐           │  ← 按分类展示
│ │背心│ │背心│ │    │           │
│ │ 0  │ │ 0  │ │    │           │
│ └────┘ └────┘ └────┘           │
│  👖 裤子                        │
│ ┌────┐ ┌────┐                  │
│ │休闲│ │休闲│                  │
│ │裤  │ │裤  │                  │
│ └────┘ └────┘                  │
│  👟 鞋                          │
│ ┌────┐                         │
│ │乐福│                         │
│ │鞋  │                         │
│ └────┘                         │
│                          [ ➕ ] │  ← 悬浮添加按钮
└─────────────────────────────────┘
```

#### 排序弹窗

```
┌─────────────────────────────────┐
│         展示设置                │
│  ☑ 按分类展示                   │
│  ○ 按颜色展示                   │
│  ─────────────────────────────  │
│         排序设置                │
│  ☑ 默认排序                     │
│  ○ 按穿着次数排序（OOTD）        │
│  ○ 按穿着成本排序（CPW）         │
│  ○ 按购买价格排序               │
│  ○ 按购买时间排序               │
└─────────────────────────────────┘
```

#### 组件拆解

**A. 分类展示区块**
| 属性 | 值 |
|------|-----|
| 标题 | 图标(32rpx) + 分类名(32rpx/600) |
| 标题行 | 高度64rpx，内边距32rpx |
| 物品网格 | 每行3个，间距16rpx |
| 物品卡片 | 正方形图片 + 底部名称(22rpx) + 数量角标 |
| 卡片圆角 | 16rpx |

**B. 排序弹窗（ActionSheet）**
| 属性 | 值 |
|------|-----|
| 弹出方式 | 从底部滑入 |
| 背景 | 白色 |
| 圆角 | 顶部28rpx |
| 选项高度 | 96rpx |
| 选中态 | 右侧紫色✓圆形 |
| 未选中态 | 右侧空心圆 |
| 分割线 | 分组间灰色分割线 |

**C. 悬浮添加按钮**
| 属性 | 值 |
|------|-----|
| 位置 | 右下角，距底部180rpx，距右侧32rpx |
| 直径 | 96rpx |
| 背景 | $color-primary-light |
| 图标 | 白色"+"，36rpx |
| 阴影 | 0 4px 16px rgba(108, 92, 231, 0.3) |
| 动画 | 按压缩小 scale(0.95) |

---

### 3.5 AI穿搭解析页（新增）

#### 页面结构

```
┌─────────────────────────────────┐
│ <     解析穿搭照    解析平铺图   │  ← 返回 + Tab切换
├─────────────────────────────────┤
│                                 │
│  AI批量解析上传—穿搭照           │  ← 大标题
│ ┌─────────────────────────────┐│
│ │                             ││
│ │    ┌──────────────────┐     ││
│ │    │                  │     ││
│ │    │   穿搭示例图片    │     ││
│ │    │        🟣AI      │     ││
│ │    │                  │     ││
│ │    └──────────────────┘     ││
│ │                             ││
│ │  • 点击上传自己的穿搭照       ││
│ │  • AI将自动识别人物穿搭       ││
│ │  • 拆分成单品批量上传         ││
│ │  • 解析一次消耗1点数          ││
│ │                             ││
│ └─────────────────────────────┘│
│ ┌─────────────────────────────┐│
│ │  永久会员获赠100点    成为永久会员│
│ └─────────────────────────────┘│
│                                 │
│       AI点数：3点               │
│  ┌─────────────────────────────┐│
│  │        上传穿搭照           ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

#### AI解析结果页

```
┌─────────────────────────────────┐
│ <     解析穿搭照    解析平铺图   │
├─────────────────────────────────┤
│ ┌──────────┐  宽松版型         │
│ │          │  土灰绿            │
│ │  穿搭照  │  ┌──────────┐    │
│ │          │  │ 裤子正面  │    │
│ │    🟣AI  │  └──────────┘    │
│ │          │  ┌──────────┐    │
│ │          │  │ 裤子背面  │    │
│ └──────────┘  └──────────┘    │
│                                 │
│  退出当前页会进行后台解析        │
│  解析完成后的单品将自动展示      │
│                                 │
│  ┌─────────────────────────────┐│
│  │        正在解析...          ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

#### 解析完成弹窗

```
┌─────────────────────────────────┐
│                                 │
│  以下是解析出的单品，可批量选择上传 │
│                                 │
│ ┌──────┐ ┌──────┐ ┌──────┐    │
│ │ 裤子  │ │ 裤子  │ │ 背心  │    │  ← 单品网格
│ │  ✅   │ │  ✅   │ │  ✅   │    │
│ └──────┘ └──────┘ └──────┘    │
│ ┌──────┐                      │
│ │ 乐福鞋│                      │
│ │  ✅   │                      │
│ └──────┘                      │
│                                 │
│ ☑ 全选        [取消]  [确定]    │
└─────────────────────────────────┘
```

---

## 四、布局规范

### 4.1 页面级布局

| 属性 | 规范 |
|------|------|
| 页面水平内边距 | 32rpx |
| 卡片外边距 | 左右32rpx，上16rpx |
| 卡片内边距 | 24-32rpx |
| 区块间距 | 24rpx |
| 卡片间距 | 16rpx |
| 页面底部安全区 | 额外200rpx（TabBar页面） |

### 4.2 对齐规则

- **左对齐**：所有标题、正文、菜单文字
- **居中对齐**：TabBar图标文字、按钮文字、网格内容
- **右对齐**：箭头、点赞数、数量角标

### 4.3 响应式

- 使用 rpx 单位（750rpx = 屏幕宽度）
- 图片使用 `mode="aspectFill"` 或 `mode="aspectFit"`
- 列表使用 ScrollView 或原生滚动

---

## 五、交互逻辑推断

### 5.1 全局交互模式

| 交互 | 行为 | 实现方式 |
|------|------|---------|
| 页面跳转 | navigateTo（非Tab页） | `Taro.navigateTo()` |
| Tab切换 | switchTab | `Taro.switchTab()` |
| 返回上一页 | navigateBack | `Taro.navigateBack()` |
| 按压反馈 | 缩小+变色 | CSS `active` 伪类 |
| 下拉刷新 | 重新加载数据 | `usePullDownRefresh` |
| 上拉加载 | 加载更多 | `useReachBottom` |
| Toast提示 | 操作反馈 | `Taro.showToast()` |
| 底部弹窗 | 操作选择/确认 | 自定义Modal组件 |
| 确认弹窗 | 删除/退出等危险操作 | `Taro.showModal()` |

### 5.2 各按钮点击行为详表

**首页：**
| 按钮 | 行为 | 跳转 |
|------|------|------|
| 我的衣橱卡片 | switchTab | wardrobe页 |
| 今日穿搭卡片 | 跳转 | 新建穿搭记录页 |
| 搭配DIY卡片 | 跳转 | DIY搭配页（新增） |
| AI搭配图标 | switchTab | suggest页 |
| 帮我搭配图标 | 跳转 | 社区页（新增） |
| 搭配DIY图标 | 跳转 | DIY搭配页（新增） |
| 穿搭日记图标 | switchTab | history页 |
| 穿搭评测图标 | 跳转 | 评测页（新增） |
| 拍照搜搭配图标 | 跳转 | 拍照搜索页（新增） |
| 邀请有礼图标 | 跳转 | 邀请页 |
| 会员中心图标 | 跳转 | 会员页 |
| 上传衣服按钮 | 拍照/相册选择 | 上传流程 |
| TabBar悬浮+ | 弹出底部操作面板 | ActionSheet |

**搭配页：**
| 按钮 | 行为 |
|------|------|
| 我的搭配Tab | 切换到用户收藏的搭配 |
| AI搭配Tab | 切换到AI推荐搭配列表 |
| 商品搭配Tab | 切换到商品推荐 |
| 搭配卡片 | 展开详情 |
| 单品图片 | 跳转衣物详情 |
| 点赞按钮 | 切换点赞状态 |

**个人中心：**
| 按钮 | 行为 |
|------|------|
| 头像 | 编辑个人资料 |
| 粉丝/关注/获赞 | 跳转数据详情 |
| 了解会员 | 跳转会员页 |
| 功能图标 | 跳转对应页面 |
| 菜单项 | 跳转对应页面 |
| 退出登录 | 弹窗确认 → 清除token → 跳转登录 |

**衣橱页：**
| 按钮 | 行为 |
|------|------|
| 筛选图标 | 弹出排序/展示设置弹窗 |
| 分类标题 | 展开/折叠该分类 |
| 衣物卡片 | 跳转衣物详情 |
| 悬浮+按钮 | 拍照/相册上传 |
| 衣橱统计 | 跳转统计页 |
| 衣橱设置 | 跳转设置页 |

---

## 六、数据结构推测

### 6.1 AI搭配方案

```typescript
interface AIOutfitPairing {
  id: string;                    // 方案ID
  user_id: string;               // 创建者ID
  type: 'ai' | 'user' | 'product'; // 方案类型
  
  // 衣物列表
  items: {
    id: string;                  // 衣物ID
    name: string;                // 衣物名称
    type: string;                // 类型（shirt/pants/shoes...）
    primary_color: string;       // 主色
    thumbnail_url: string;       // 缩略图URL
    image_url: string;           // 原图URL
    brand?: string;              // 品牌
  }[];
  
  // 搭配信息
  title?: string;                // 搭配标题
  reasoning?: string;            // AI推荐理由
  occasion?: string;             // 适用场合
  season?: string;               // 适用季节
  style_tags?: string[];         // 风格标签
  
  // 效果图
  model_image_url?: string;      // 模特穿搭效果图
  flat_lay_image_url?: string;   // 平铺组合图
  
  // 社交数据
  like_count: number;            // 点赞数
  is_liked_by_me?: boolean;      // 当前用户是否已赞
  
  // 元数据
  created_at: string;
  updated_at: string;
}
```

### 6.2 身材档案

```typescript
interface BodyProfile {
  user_id: string;
  
  // 基本信息
  birthday?: string;             // 生日
  height_cm?: number;            // 身高(cm)
  weight_kg?: number;            // 体重(kg)
  
  // 体型详情
  body_type?: string;            // 身型（hourglass/pear/apple/rectangle/...）
  leg_type?: string;             // 腿型（straight/X/O/...）
  shoulder_type?: string;        // 肩型（straight/sloped/broad/narrow）
  shoulder_width?: string;       // 肩宽（narrow/normal/broad）
  collarbone?: string;           // 锁骨（prominent/average/none）
  bust?: string;                 // 胸部（large/medium/small）
  waist?: string;                // 腰腹部（slim/average/round）
  hip?: string;                  // 胯部（wide/average/narrow）
  buttock_type?: string;         // 臀型（round/flat/...）
  thigh?: string;                // 大腿（thick/average/slim）
  calf?: string;                 // 小腿（thick/average/slim）
  upper_lower_ratio?: string;    // 上下身比例（long-torso/balanced/long-legs）
  
  // 外观
  skin_tone?: string;            // 肤色（fair/light/medium/tan/dark）
  
  // 调整目标
  want_to_improve?: string[];    // 想修饰的点
  body_strengths?: string[];     // 身材优点
}
```

### 6.3 社交动态

```typescript
interface UserPost {
  id: string;
  user_id: string;
  user: {
    id: string;
    display_name: string;
    avatar_url?: string;
  };
  
  content: string;               // 文字内容
  images?: string[];             // 图片URL列表
  
  // 穿搭相关
  outfit_id?: string;            // 关联的穿搭方案
  items?: ClothingItem[];        // 使用的衣物
  
  // 互动
  like_count: number;
  comment_count: number;
  is_liked_by_me: boolean;
  
  created_at: string;
}
```

### 6.4 用户关系

```typescript
interface UserRelation {
  follower_id: string;           // 关注者
  following_id: string;          // 被关注者
  created_at: string;
}

// 用户统计
interface UserStats {
  follower_count: number;        // 粉丝数
  following_count: number;       // 关注数
  like_received_count: number;   // 获赞数
  post_count: number;            // 动态数
  outfit_count: number;          // 穿搭数
}
```

### 6.5 会员/积分系统

```typescript
interface Membership {
  user_id: string;
  level: 'free' | 'monthly' | 'permanent';  // 会员等级
  ai_points: number;             // AI点数
  points_history: {
    id: string;
    change: number;              // 变化量（正/负）
    reason: string;              // 原因（parse/outfit/buy...）
    created_at: string;
  }[];
  expires_at?: string;           // 到期时间
  created_at: string;
}
```

---

## 七、技术实现要点

### 7.1 渐变背景实现

```scss
// 首页渐变背景 — 注意：小程序不支持 background-attachment: fixed
.home-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #FFF0E6 0%, #FFE8F0 40%, #F5F0FF 100%);
  // 需要让背景覆盖全屏，使用固定高度或 min-height
}
```

**难点：** 微信小程序中 `linear-gradient` 需要使用 `px` 而非 `rpx` 在某些旧版本。建议统一使用 rpx 并测试兼容性。

### 7.2 自定义TabBar

```typescript
// app.config.ts — 使用 customTabBar
export default defineAppConfig({
  tabBar: {
    custom: true,  // 关键：启用自定义TabBar
    list: [
      // 仍需保留list，但实际显示自定义组件
      { pagePath: 'pages/wardrobe/index', text: '衣橱' },
      { pagePath: 'pages/suggest/index', text: '搭配' },
      { pagePath: 'pages/discover/index', text: '发现' },
      { pagePath: 'pages/profile/index', text: '我的' },
    ],
  },
})
```

**难点：** 
- 自定义TabBar需要在每个Tab页面的 `config` 中设置 `navigationStyle: 'custom'`
- 悬浮"+"按钮需要使用 `cover-view`（如果在地图/Canvas上）或普通 `view`
- TabBar切换动画需要手动实现

### 7.3 卡片进场动画

```scss
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(24rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.card-animate {
  animation: fadeInUp 0.4s ease-out forwards;
  
  @for $i from 1 through 6 {
    &:nth-child(#{$i}) {
      animation-delay: #{$i * 0.05}s;
    }
  }
}
```

**注意：** Taro/微信小程序对 CSS animation 支持良好，但 `@for` 循环需要在 SCSS 编译阶段处理，不能运行时生成。

### 7.4 AI扫描光效

```scss
@keyframes aiScan {
  0% { opacity: 0; transform: scale(0.5); }
  50% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.5); }
}

.ai-glow {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(108, 92, 231, 0.6), transparent 70%);
  animation: aiScan 2s ease-in-out infinite;
}
```

### 7.5 底部弹窗（ActionSheet）

```tsx
// 使用 Taro 原生 ActionSheet 或自定义
import Taro from '@tarojs/taro'

// 方案1：Taro原生
Taro.showActionSheet({
  itemList: ['📷 拍照上传', '🖼️ 从相册选择', '📋 AI批量解析'],
  success: (res) => {
    switch (res.tapIndex) {
      case 0: // 拍照
        break
      case 1: // 相册
        break
      case 2: // AI解析
        break
    }
  },
})

// 方案2：自定义底部弹窗（更精美，支持自定义样式）
// 创建 components/BottomSheet 组件
```

**难点：** Taro原生ActionSheet样式不可自定义，要达到搭搭的精美效果需要自己实现底部弹窗组件。

### 7.6 列表性能优化

```tsx
// 使用 Taro 的 VirtualList 或手动分页
// 衣物列表建议：
// 1. 分页加载（每页30条）
// 2. 使用 useMemo 缓存分组结果
// 3. 图片使用 CachedImage 组件（已有）
// 4. 避免在滚动区域使用复杂计算
```

### 7.7 图标系统方案

**推荐方案：SVG Sprite 或自定义组件**

```tsx
// components/Icon.tsx
const ICONS = {
  wardrobe: require('../assets/icons/wardrobe.svg'),
  outfit: require('../assets/icons/outfit.svg'),
  discover: require('../assets/icons/discover.svg'),
  profile: require('../assets/icons/profile.svg'),
  // ... 更多图标
}

interface IconProps {
  name: keyof typeof ICONS
  size?: number
  color?: string
}
```

**注意：** 微信小程序不支持内联SVG，需要将SVG转为图片或使用iconfont。

### 7.8 兼容性注意事项

| 特性 | 支持情况 | 替代方案 |
|------|---------|---------|
| backdrop-filter | iOS支持，Android部分支持 | 使用半透明背景色代替 |
| linear-gradient | 完全支持 | - |
| CSS animation | 完全支持 | - |
| position: sticky | 支持 | - |
| flex gap | Taro 4.2支持 | 使用margin替代 |
| CSS Grid | 部分支持 | 使用flex替代 |
| transform scale | 支持 | - |
| 100vh | 部分机型有问题 | 使用动态计算高度 |

---

## 八、新增页面清单

| 页面 | 路径 | 说明 |
|------|------|------|
| 发现页 | pages/discover/index | 社交Feed流 |
| AI解析 | pages/parse/index | 穿搭照/平铺图解析 |
| 搭配DIY | pages/diy/index | 自由搭配 |
| 身材档案 | pages/body-profile/index | 身材信息录入 |
| 社区 | pages/community/index | 帮Ta搭配 |
| 穿搭评测 | pages/evaluation/index | AI评测 |
| 会员中心 | pages/membership/index | 会员信息 |
| 穿搭详情 | pages/outfit-detail/index | 单个搭配方案详情 |

---

## 九、文件结构规划

```
wechat-mini/src/
├── app.config.ts              # 需修改：自定义TabBar + 新页面路由
├── app.scss                   # 需修改：全局设计系统
├── app.ts
├── styles/                    # 【新增】设计系统
│   ├── tokens.scss           # 设计Token变量
│   ├── mixins.scss           # 可复用SCSS混入
│   └── animations.scss       # 动画库
├── assets/
│   ├── icons/                # 【新增】SVG图标
│   │   ├── wardrobe.svg
│   │   ├── outfit.svg
│   │   ├── discover.svg
│   │   ├── profile.svg
│   │   ├── ai-outfit.svg
│   │   ├── diy.svg
│   │   ├── diary.svg
│   │   ├── review.svg
│   │   ├── search.svg
│   │   ├── invite.svg
│   │   └── vip.svg
│   └── images/               # 【新增】插图资源
├── components/                # 【扩展】通用组件
│   ├── CachedImage.tsx       # 已有
│   ├── BottomSheet.tsx       # 【新增】底部弹窗
│   ├── GradientBg.tsx        # 【新增】渐变背景
│   ├── Icon.tsx              # 【新增】图标组件
│   ├── OutfitCard.tsx        # 【新增】搭配卡片
│   ├── CategorySection.tsx   # 【新增】分类展示区块
│   ├── SortPopup.tsx         # 【新增】排序弹窗
│   └── CustomTabBar/         # 【新增】自定义TabBar
│       ├── index.tsx
│       └── index.scss
├── pages/
│   ├── home/                 # 需重写
│   ├── wardrobe/             # 需重写
│   ├── suggest/              # 需重写
│   ├── profile/              # 需重写
│   ├── history/              # 小幅修改
│   ├── discover/             # 【新增】
│   ├── parse/                # 【新增】
│   ├── diy/                  # 【新增】
│   ├── body-profile/         # 【新增】
│   ├── community/            # 【新增】
│   ├── evaluation/           # 【新增】
│   ├── membership/           # 【新增】
│   └── outfit-detail/        # 【新增】
├── types/
│   └── index.ts              # 需扩展：新增类型定义
├── constants/
│   └── index.ts              # 需扩展
└── utils/
    └── api.ts                # 已有，可复用
```

---

## 十、实施优先级

| 优先级 | 任务 | 预估工作量 |
|--------|------|-----------|
| P0 | 设计系统（tokens + mixins + animations） | 小 |
| P0 | 全局样式升级（app.scss） | 小 |
| P0 | 自定义TabBar（含悬浮按钮） | 中 |
| P1 | 首页重构 | 大 |
| P1 | 搭配页升级 | 大 |
| P1 | 个人中心重设计 | 中 |
| P2 | 衣橱页优化 | 中 |
| P2 | 新增发现页 | 中 |
| P3 | AI解析页 | 大 |
| P3 | 身材档案页 | 中 |
| P4 | 搭配DIY页 | 大 |
| P4 | 社区页 | 大 |
| P5 | 穿搭评测/会员中心 | 中 |

---

*本文档版本：v1.0 | 更新时间：2026-05-28*
*基于"搭搭"App截图分析生成，供Wardrowbe微信小程序仿制参考*