# Wardrowbe 重构方案 — 模仿搭搭 + 双衣橱体系

> 目标：精简臃肿代码、统一上传入口、实现"电子衣橱 + 试穿衣橱"双轨制，
> 让小程序在保留搭搭式核心体验的同时，做到代码干净、架构清晰、一人可维护。

---

## 一、总览：改动分 5 个阶段

| 阶段 | 内容 | 预计工作量 |
|------|------|-----------|
| ① 清理死代码 | 删除残留文件、精简配置 | 30 分钟 |
| ② 后端重构 | 新增 `tryon_ready` 字段 + 数据库迁移 | 1 小时 |
| ③ 小程序页面清理 | 删 3 个空壳页面、保留 3 个占位页 | 30 分钟 |
| ④ 统一上传 + 双衣橱 UI | 核心功能，打通 parse→预览→入库→双衣橱展示 | 3-4 小时 |
| ⑤ AI 对话入口 + 试穿联动 | 补上缺失的入口和交互链路 | 2 小时 |

---

## 二、阶段 ①：清理死代码

### 2.1 删除文件

| 文件 | 原因 |
|------|------|
| `backend/app/services/write_oss.py` | 只有 2 行 import 的空文件 |
| `backend/app/services/test_write.txt` | 调试残留 |
| `backend/app/services/test.txt` | 调试残留 |

### 2.2 从 requirements.txt 移除

```
rembg[cpu]>=2.0.75
onnxruntime>=1.16.0
```

理由：阿里云 `SegmentCommodity` / `SegmentCloth` 已经完全覆盖抠图需求。
`rembg` 占 ~800MB 镜像空间且非常吃内存，本地开发和 Docker 都有负担。

### 2.3 config.py 精简

```python
# 生产环境请使用 ALIYUN_OSS_* 配置
```

### 2.4 background_removal.py 简化

将 `rembg` provider 替换为直接调用阿里云 `SegmentCommodity`，
这样 `background_removal.py` 就是一个统一的抠图入口，底层只走阿里云。

---

## 三、阶段 ②：后端重构 — 双衣橱数据模型

### 3.1 核心概念

```
ClothingItem.来源场景 = "commodity"（平铺/折叠图）
ClothingItem.来源场景 = "avatar"（穿搭/上身图）
```

- `commodity` → 存入 **电子衣橱**（管理/浏览/搭配灵感）
- `avatar` → 存入 **试穿衣橱**（可直接用于 AI 虚拟试穿）

### 3.2 数据库字段变更

在 `clothing_items` 表新增：

```python
# 后端 app/models/item.py
source_scene: Mapped[str] = mapped_column(
    String(20), default="commodity"  # "commodity" | "avatar"
)
tryon_ready: Mapped[bool] = mapped_column(Boolean, default=False)
```

- `source_scene`：记录用户上传时的场景类型（平铺 vs 穿搭照）
- `tryon_ready`：`True` = 可用于虚拟试穿，`False` = 仅衣橱管理

### 3.3 自动判定逻辑

在 `items.py` 的 `create_items_from_parse` 和 `tag_item_image` 中：

```python
# 从 parse 接口入库时
if scene_type == "avatar":
    item.source_scene = "avatar"
    item.tryon_ready = True  # 穿搭照默认可试穿
else:
    item.source_scene = "commodity"
    item.tryon_ready = False  # 平铺图默认不可试穿
```

### 3.4 虚拟试穿接口过滤

`virtual_tryon.py` 的 `_resolve_garment_urls` 只选择 `tryon_ready=True` 的衣物：

```python
result = await db.execute(
    select(ClothingItem).where(
        ClothingItem.id == item_id,
        ClothingItem.tryon_ready == True  # 只选可试穿的
    )
)
```

### 3.5 新增 API 端点

```
GET /api/v1/items?tryon_ready=true   → 获取试穿衣橱
GET /api/v1/items?tryon_ready=false  → 获取电子衣橱
GET /api/v1/items?source_scene=avatar → 同上，按来源筛选
```

现有的 `list_items` 接口已经支持 type/status/favorite 等过滤，
只需在 `ItemFilter` 中新增 `tryon_ready` 和 `source_scene` 过滤字段即可。

### 3.6 Alembic 迁移

```python
# 新增迁移文件
def upgrade():
    op.add_column('clothing_items', sa.Column('source_scene', sa.String(20), server_default='commodity'))
    op.add_column('clothing_items', sa.Column('tryon_ready', sa.Boolean(), server_default='false'))
    # 对已存在的 avatar 类型衣物（从 parse 入库的），更新 tryon_ready
    op.execute("UPDATE clothing_items SET tryon_ready = true WHERE ai_raw_response->>'scene_type' = 'avatar'")
```

---

## 四、阶段 ③：小程序页面清理

### 4.1 删除的页面（3 个，完全没有入口）

| 页面 | 原因 |
|------|------|
| `pages/discover` | 空壳，全 Mock 数据，无任何入口 |
| `pages/evaluation` | 纯前端假问卷假报告，无 API 对接 |
| `pages/ootd` | 和 `history` 页面功能重叠 |

从 `app.config.ts` 中移除这 3 个路由。

### 4.2 保留为占位的页面（3 个）

| 页面 | 处理方式 |
|------|---------|
| `pages/community` | 保留，保持现在的状态（有基本 UI，后续完善） |
| `pages/membership` | 保留，保持"支付功能开发中"提示 |
| `pages/outfit-detail` | 保留，给搭配推荐详情用 |

### 4.3 保留并持续完善的页面（16 个）

```
核心 4 tab：home, wardrobe, suggest, profile
功能页：  login, onboarding, item-detail, chat, preferences, analytics,
         history, parse, diy, body-profile, item-select
占位页：  community, membership, outfit-detail
```

---

## 五、阶段 ④：统一上传 + 双衣橱 UI（核心改动）

### 5.1 统一上传入口

**现状：** 两条上传路径，用户困惑

```
路径 A：wardrobe 页 "+" → captureAndUpload('/items') → 单件上传 → 后台异步识别
路径 B：home 页"上传衣服" → parse 页 → /items/parse → 实时解析 → /items/from-parse
```

**目标：** 合并为一条

```
所有上传 → parse 页 → 实时解析 → 预览拆分结果 → 确认入库
```

**改动：**

1. `wardrobe/index.tsx` 的 `handleAddItem` 改为跳转到 parse 页：
```typescript
const handleAddItem = () => {
  Taro.navigateTo({ url: '/pages/parse/index' })
}
```

2. `upload.ts` 中的 `captureAndUpload` 不再用于衣物上传（保留给其他可能的场景）

### 5.2 parse 页面增强

当前 parse 页面已经很完善，需要增加以下功能：

**a) 场景选择更明确**

把现在的"穿搭照 / 平铺图" tab 改成更用户友好的引导：

```
┌─────────────────────────────┐
│  📸 上传衣物照片            │
│                             │
│  ┌──────────┐ ┌──────────┐ │
│  │ 👗 穿搭照 │ │ 👕 平铺图 │ │
│  │ 穿在身上  │ │ 折叠/平铺 │ │
│  │ 可用于试穿 │ │ 存入衣橱  │ │
│  └──────────┘ └──────────┘ │
│                             │
│  💡 穿搭照可以 AI 试穿      │
│     平铺图方便快速录入       │
└─────────────────────────────┘
```

**b) 入库时传递 scene_type**

当前的 `handleSaveItems` 已经传递 `scene_type`，✅ 无需改动。

**c) 入库成功后跳转优化**

- 穿搭照入库 → 跳转到试穿衣橱 tab
- 平铺图入库 → 跳转到电子衣橱 tab

### 5.3 wardrobe 页面改造：双 tab 衣橱

**现状：** 衣橱页只有"按分类 / 按颜色"两种展示方式

**目标：** 加入"电子衣橱 / 试衣间"顶层切换

```
┌─────────────────────────────────────┐
│  我的衣橱                    🔍 筛选 │
│                                     │
│  ┌──────────┐ ┌──────────┐         │
│  │ 👔 电子衣橱 │ │ 🪞 试衣间  │         │
│  └──────────┘ └──────────┘         │
│                                     │
│  ┌──────┐ ┌──────┐ ┌──────┐       │
│  │ T恤  │ │ T恤  │ │ 裤子  │       │
│  │ 黑色  │ │ 白色  │ │ 蓝色  │       │
│  └──────┘ └──────┘ └──────┘       │
│                                     │
│             ＋ 添加衣物              │
└─────────────────────────────────────┘
```

**电子衣橱 tab（默认）：**
- 调用 `GET /items?tryon_ready=false` 或 `GET /items?source_scene=commodity`
- 功能：浏览、分类、搜索、编辑、记录穿搭

**试衣间 tab：**
- 调用 `GET /items?tryon_ready=true` 或 `GET /items?source_scene=avatar`
- 功能：浏览、选择试穿、关联 AI 对话
- 每件衣物卡片上显示 "🪞 可试穿" 标记
- 长按/右上角按钮："去试穿" → 调用虚拟试穿

**空状态提示：**

电子衣橱为空：
```
👔 还没有衣物
拍一张平铺照片，AI 帮你自动识别分类
[📸 上传衣物]
```

试衣间为空：
```
🪞 还没有可试穿的衣物
拍一张穿搭照，AI 帮你拆分入库
[📸 上传穿搭照]
💡 也可以在电子衣橱中为衣物补拍上身照
```

### 5.4 item-detail 页面增强

在衣物详情页新增：
- **来源标记**：显示"平铺图"或"穿搭照"标签
- **试穿状态**：如果 `tryon_ready=true`，显示"🪞 可试穿"标记
- **试穿按钮**：如果 `tryon_ready=true`，显示"去试穿"按钮 → 调虚拟试穿
- **补拍提示**：如果 `tryon_ready=false`，显示"拍一张上身照，解锁 AI 试穿"入口

---

## 六、阶段 ⑤：AI 对话入口 + 试穿联动

### 6.1 问题

当前 `chat` 页面**没有任何入口**！只有 `app.config.ts` 注册了路由，
但没有任何页面跳转到 `/pages/chat/index`。

### 6.2 添加入口的位置

| 入口位置 | 交互方式 |
|---------|---------|
| suggest 页面 AI 搭配 tab | 顶部加"💬 和 AI 聊聊穿搭"入口 |
| home 首页快捷入口 | 加一个"🤖 AI 造型师"入口 |
| wardrobe 试衣间 tab | 空状态时提示"去和 AI 聊聊获取灵感" |
| item-detail 详情页 | "让 AI 推荐搭配这件衣物"按钮 |

### 6.3 AI 对话 + 试穿联动

用户在 AI 对话中获得搭配推荐后：

```
AI：我建议你穿这件黑色西装外套 + 白色衬衫 + 蓝色西裤

┌─────────────────────────┐
│  👔 黑色西装外套          │
│  👔 白色衬衫              │
│  👖 蓝色西裤              │
│                         │
│  [🪞 虚拟试穿] [📸 记录] │
└─────────────────────────┘
```

点击"虚拟试穿" → 打开 VirtualTryOnModal（已实现组件）

---

## 七、页面导航结构（最终形态）

```
tabBar（底部 4 个）
├── 首页 home
│   ├── 天气卡片
│   ├── 快捷入口：AI搭配 | 衣橱 | 搭配DIY | 上传衣服 | 帮Ta搭配
│   └── 今日穿搭 + AI 造型师入口
│
├── 衣橱 wardrobe
│   ├── 电子衣橱 tab（默认）
│   │   ├── 按分类/颜色筛选
│   │   └── "+"按钮 → 跳转 parse 页
│   ├── 试衣间 tab
│   │   ├── 只展示 tryon_ready=true 的衣物
│   │   └── 每件可直接触发虚拟试穿
│   └── 搜索/排序
│
├── 搭配 suggest
│   ├── 我的搭配 tab
│   ├── AI搭配 tab + 💬 AI对话入口
│   ├── 搭配灵感 tab
│   └── VirtualTryOnModal（选择衣物后试穿）
│
└── 我的 profile
    ├── 身材档案 body-profile
    ├── 衣橱统计 analytics
    ├── 偏好设置 preferences
    ├── 穿搭日记 history
    ├── 修改个人资料 → onboarding
    ├── 会员 membership（占位）
    └── 社区 community（占位）
```

---

## 八、不在此次改动范围内的功能（保留代码，后续迭代）

| 功能 | 说明 |
|------|------|
| 社区互助 | 前后端代码保留，后续有用户后完善 |
| 会员系统 | 保留占位页，后续接入支付 |
| 公众号通知 | 通知模块保留，后续接入微信模板消息 |
| 家庭共享 | families 模块保留 |
| 学习系统 | learning 模块保留 |
| 穿搭日历增强 | history 页保留现有功能 |

---

## 九、技术注意事项

### 9.1 OSS 必须配置

虚拟试穿（DashScope OutfitAnyone）要求图片必须是公网可达的 HTTP URL。
现在用 OSS 存储，确保所有衣物图片上传时都同步到 OSS 并保存 `public_url`。


### 9.2 双衣橱是前端概念

后端只新增 `source_scene` 和 `tryon_ready` 两个字段，
"电子衣橱"和"试衣间"只是前端按这两个字段做筛选展示，
不需要额外的数据库表或后端模块。

### 9.3 向下兼容

已有的衣物数据默认 `source_scene="commodity"`, `tryon_ready=false`，
不会影响现有用户数据。
