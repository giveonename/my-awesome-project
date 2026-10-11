# AGENTS.md — Wardrowbe（魔搭幻穿）

> AI 穿搭助手微信小程序：FastAPI 后端 + Taro/React 小程序
> 本文件是 AI 助手的权威工作文档；面向人的项目介绍见 `README.md`，历史方案见 `docs/archive/`。

## 技术栈

| 层 | 技术 |
|---|------|
| 小程序 | Taro 4.2 + React 18 + TypeScript + SCSS |
| 后端 | FastAPI + SQLAlchemy (async) + Pydantic v2 + Python ≥3.11 |
| 数据库 | PostgreSQL 15 + Redis 7 |
| 后台任务 | arq（衣物识别、通知推送、学习画像更新） |
| AI 文本/视觉理解 | DeepSeek（OpenAI 兼容格式，走 AI_* 环境变量；模型 ID `deepseek-flash`，区分大小写） |
| AI 虚拟试衣 | DashScope qwen-image-3.0（原 OutfitAnyone/aitryon 全家已于 2026-10-10 下线） |
| 图像处理 | 阿里云视觉智能（分割）；图片存储为本地卷+签名 URL（OSS 可选，仅历史数据/公网部署） |
| 天气 | 和风天气 v7（国内优先）+ Open-Meteo（fallback） |
| 电商 | 淘宝联盟 API |
| 认证 | 微信小程序登录（OIDC 为兼容保留） |

> 历史：本项目基于开源模板 Anyesh/wardrowbe（英文自托管衣橱）二次开发，模板的 Next.js Web 前端已于 2026-10 移除，仅小程序端活跃。

## 两个子项目

- `backend/` — FastAPI 后端，入口 `app/main.py`，路由注册 `app/api/router.py`
- `wechat-mini/` — Taro 微信小程序，入口 `src/app.ts`，路由配置 `src/app.config.ts`（22 个注册页面）

## 常用命令

```bash
# === 构建 & 启动 ===
docker compose up -d --build          # 全部启动
# 后端改代码后（容器从镜像启动、不挂载源码）：重建后端即可（首选！镜像构建已配国内 apt/pip 镜像源）
docker compose up -d --build backend worker
# .\sync-backend.cmd 为遗留的手动同步方式，曾导致容器与仓库代码漂移，不再推荐
cd wechat-mini && npm run build:weapp # 构建小程序（产物在 dist/）

# === 后端开发（本地热重载）===
docker compose stop backend worker
set PYTHONUTF8=1
cd backend && ..\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --env-file ../.env
# 另一终端启动 worker:
backend\.venv\Scripts\python.exe -m arq app.workers.worker.WorkerSettings

# === Lint & 格式化 ===
ruff check --fix backend/app/ && ruff format backend/app/   # 后端（line-length=100, py311）

# === 测试（需要运行中的 PostgreSQL + Redis，conftest 会建 wardrobe_test 库并跑迁移）===
docker compose exec backend python -m pytest tests/ -v --tb=short

# === 数据库迁移（图已损坏，务必先看 heads！）===
docker compose exec backend alembic heads      # 查看所有 head（当前 5 个）
docker compose exec backend alembic upgrade <revision>  # 逐个执行每个 head

# === 健康检查 ===
curl http://localhost:8000/api/v1/health
```

## 重要约定 & 踩坑

### 数据库迁移图已损坏（动手前必读！）

`migrations/versions/` 现状：**5 个 head**（`a1b2c3d4e5f6`、`add_public_url`、`e1f2g3h4i5j6`、`d2b280660baa`、`f1a2b3c4d5e6`）+ **重复 revision ID**（`add_wash_tracking.py` 与 `a1b2c3d4e5f6_add_full_body_photo_url.py` 共用 `a1b2c3d4e5f6`，Alembic 加载时告警）+ `f1a2b3c4d5e6` 的 `down_revision=None` 是个假根。因此：

- `alembic upgrade head` 只会升级其中一个 head，永远不完整
- 正确做法：`alembic heads` 列出全部 → 逐个 `alembic upgrade <revision>`
- 线上库是靠逐个 upgrade 打上来的；修复迁移图（线性化）属于高风险重构，需单独规划

### ChatMessage.metadata 字段映射

SQLAlchemy 中 `metadata` 是保留字段名。ORM 模型用 `extra_metadata`，数据库列名仍为 `metadata`：

```python
# models/chat.py
extra_metadata: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)

# schemas/chat.py — Pydantic 用 validation_alias 桥接
metadata: dict = Field(default_factory=dict, validation_alias="extra_metadata")

# api/chat.py — 用 ORM 属性名访问
msg.extra_metadata.get("outfit_suggestions")
```

### Prompt 文件编码

Windows 默认 GBK，prompt 文件是 UTF-8（含中文）。`load_prompt()` 必须指定 `encoding="utf-8"`。

### OUTFIT 标记解析

AI 对话中搭配方案用 `<<<OUTFIT>>>...<<<END>>>` 标记。AI 有时输出 `<<<>>>` 而非 `<<<END>>>`，正则必须兼容两种。

### 衣物识别中文保障

Prompt 用英文指令（模型更易遵守），强制 `name`/`description` 用中文。后处理检测到英文描述会自动重写为中文。衣物分割/多件拆分由 `aliyun_vision_service.py`（SegmentCommodity / SegmentBody）完成。

### 上传解析路由（AI 三分类，2026-10 重构）

parse 页上传时发送空 `scene_type` + 入口提示 `scene_hint`（outfit/flat），后端 `ai_service.classify_image_type`（prompt: `prompts/image_classify.txt`）用 DeepSeek 视觉把照片分为三类并路由：

- `outfit`（一整套：穿身上或摆成一套）→ SegmentCloth 抠整套 → **1 条 outfit 记录进试衣间，不拆分**（原 parsing-v1 上装/下装拆分已按设计移除）
- `flat_multi` / `flat_single`（散件平铺/单件）→ SegmentCommodity 抠图 + 连通域拆件 → 电子衣橱
- 拆分靠 `_split_transparent_image` 的连通域 + "配对合并"（同款小件极近时合并，如鞋对；间距阈值 15% 画面宽，2026-10 从 40% 收紧）
- 分割不可用时的兜底分支**只建 1 条记录**，避免"多件共图"的重复记录
- 历史教训：分类器曾在 2026-06 只存在于容器内从未入库，容器重建即丢失；本文件与仓库是唯一真相，勿再只在容器里改代码

### 天气服务链路

和风天气 v7（国内）→ Open-Meteo（海外 fallback）→ Redis 缓存降级（1h TTL）。
和风天气 icon 代码需映射到 condition，映射失败时使用 API 返回的中文 `text` 字段。

### 虚拟试衣链路（2026-10 迁移至 qwen-image-3.0）

选衣物 → `resolve_tryon_inputs`（整套 outfit 直接整图当参考、不再拆分；否则取上装+下装，最多 2 件）→ 本地图片转 Base64（**不依赖 OSS**）→ `build_tryon_prompt` 按衣物元数据生成四段式提示词（保持人物/穿着服装/成片要求/禁止；长度属性交由商品图，勿写死）→ DashScope **qwen-image-3.0** 同步生成（约 80-100 秒、0.18 元/张）→ 下载结果转存本地（官方链接 24h 失效）。`/submit` 在后台 asyncio 任务执行以保持前端轮询体验，`/status` 读内存任务表。另有 `swap_background`（SegmentBody 抠图 + PIL 合成，模板图在 `backend/app/assets/backgrounds/`）。全身照在 `BodyProfile.full_body_photo_url`，无则回退 `DEFAULT_PERSON_URL`（阿里云示例图）。天气背景图走本地路由 `/weather/backgrounds/{name}`（素材目录 `backend/app/assets/weather-bg/`，6 张图已入库；缺失时前端自动渐变兜底）。

### 淘宝联盟

无 API Key 时自动 Mock（约 35 个硬编码商品，带关键词/风格打分匹配）。真实模式调用 `taobao.tbk.dg.material.optional.upgrade`，MD5 签名。

### 虚拟试衣任务存储

Task store 在内存 `_tasks` dict 中，重启丢失（后续可改 Redis）。

### 小程序环境地址

`wechat-mini/src/env.ts` 由 `get-local-ip.cjs` 在 predev/prebuild 钩子自动生成（局域网 IP），不要手改；真机预览要求手机与后端同局域网，生产需替换为公网 HTTPS 域名。

## Docker 服务

| 服务 | 容器 | 端口 |
|------|------|------|
| postgres | wardrobe-db | 5432 |
| redis | wardrobe-redis | 6379 |
| backend | wardrobe-backend | 8000 |
| worker | wardrobe-worker | — |

数据卷：`postgres_data`、`redis_data`、`wardrobe_data`（图片）

## 关键文件速查

- `backend/app/services/virtual_tryon_service.py` — 虚拟试衣核心（提交/轮询/增强/背景切换）
- `backend/app/services/chat_service.py` — AI 对话逻辑（人设"小衣"）
- `backend/app/services/recommendation_service.py` — AI 推荐引擎（含智能关键词、上下文感知）
- `backend/app/services/learning_service.py` — 持续学习系统
- `backend/app/services/aliyun_vision_service.py` — 图像预处理/分割
- `backend/app/services/taobao_service.py` — 淘宝联盟集成
- `backend/app/api/products.py` — 智能搜索词 `_build_smart_keyword`（基于衣物/补缺/场景三模式）
- `backend/app/prompts/` — AI Prompt 模板（5 个，UTF-8 无 BOM）
- `backend/app/workers/worker.py` — arq 配置（7 job + 5 cron）
- `wechat-mini/src/utils/api.ts` — 请求封装（token、401 跳登录、错误中文化）
- `wechat-mini/src/constants/index.ts` — 中英文映射
- `wechat-mini/src/constants/icons.ts` — 内联 base64 图标（约 130KB，由 gen-icons.cjs 生成）
- `wechat-mini/src/components/VirtualTryOnModal/` — 试衣弹窗（suggest/item-detail/diy/wardrobe 共用）
- `wechat-mini/src/pages/suggest/index.tsx` — 搭配灵感（AI搭配 + 我的搭配 + 搭配灵感）
- `wechat-mini/src/pages/parse/index.tsx` — 统一上传识别页（平铺图/穿搭照双 tab）
- `wechat-mini/src/pages/diy/index.tsx` — DIY 搭配画板

## AI搭配功能

### 架构概述

```
搭配灵感页面（suggest/index.tsx）
├── Tab 1: 我的搭配 — 用户DIY创建的搭配（source=manual）
├── Tab 2: AI搭配 — AI实时生成推荐（6套，异步试穿图）
└── Tab 3: 搭配灵感 — 淘宝商品推荐
```

### AI搭配核心流程

1. 前端调用 `POST /outfits/suggest-batch`（一次返回6套）
2. 后端并行生成搭配方案
3. 异步触发试穿图生成（qwen-image-3.0，约 80-100 秒，结果转存本地）
4. 前端轮询 `POST /outfits/batch-check` 获取试穿图
5. 试穿图生成走统一的 `virtual_tryon_service`（模型由 `DASHSCOPE_TRYON_MODEL` 配置）

### 我的搭配核心流程

1. 用户在 DIY 页面创建搭配 → `POST /outfits/studio`
2. 搭配存储为 `source=manual` 的 Outfit 记录
3. 前端通过 `GET /outfits?source=manual` 加载
4. 支持场景筛选、设定场景、上传穿搭照

### 关键数据区分

| 数据类型 | source_scene | tryon_ready | 说明 |
|----------|--------------|-------------|------|
| 电子衣橱 | `commodity` | `false` | 用户上传的平铺衣物照片 |
| 试衣间 | `avatar` | `true` | 用户上传的穿搭照/全身照 |

### 虚拟试衣参数

- 模型：`qwen-image-3.0`（单一模型；0.18 元/张、约 80-100 秒。原 aitryon 基础版/Plus 双模型方案随 2026-10 下线废弃）
- 全身照来源：`BodyProfile.full_body_photo_url`，无则使用 `DEFAULT_PERSON_URL`

## 已知问题

- **数据库迁移图损坏**（见上"重要约定"），5 head + 重复 revision ID；新环境初始化务必逐个 upgrade
- Docker 容器从镜像启动（不挂载源码）：改后端代码用 `docker compose up -d --build backend worker`（优选）；`sync-backend.cmd` 为遗留手动同步方式（曾导致容器与仓库代码漂移），不再推荐
- 背景移除：rembg 已退役（`background_removal.py` 中 rembg 走桩会转阿里云）；`BG_REMOVAL_PROVIDER` 有效值为 `aliyun`（推荐）或 `http`
- 图片服务已全面本地化：浏览/识别/试衣（本地图 Base64）/天气背景均不依赖 OSS；OSS 停服仅影响历史 public_url 与公网部署场景
- 虚拟试衣任务存内存，backend 重启丢失
- 会员支付未实现（UI 已就绪，显示"即将开放"）
- AI 推荐时偶尔返回文字编号而非数字（已实现容错跳过）
- `ootd` 页面（每日穿搭：真实天气+7天预报+穿搭记录）入口在首页"今日穿搭"卡片；`history` 穿搭日历另有首页金刚区与个人页两个入口
- 小程序 SCSS 全量使用 `@import`（Dart Sass 3.0 将移除；当前 sass 锁 1.86，构建仅有警告、无风险）：迁 `@use` 属技术债，涉及全部 scss 文件且需排版回归，待后续专项处理
- 小程序多页存在 `<ScrollView>` 直接设置 padding 的旧写法（chat/diy/suggest/profile-settings 共 6 处；微信 WebView 渲染模式对 scroll-view padding 仅部分支持，devtools 会告警）：新代码规范 = padding 放内层容器（如 home 的 capsules-list）；存量迁移属技术债，改动需逐页视觉回归
- 小程序 `suggest/index.tsx` 超过 1200 行、`api/items.py` 超过 1900 行，属技术债，改动时注意局部化
- 仓库 git remote 此前指向模板仓库 Anyesh/wardrowbe，已于 2026-10 断开；推送前需自行 `git remote add origin <你的仓库>`
