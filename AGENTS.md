# AGENTS.md — Wardrowbe（魔搭幻穿）

> AI 穿搭助手微信小程序：FastAPI 后端 + Taro/React 小程序 + Next.js Web 前端

## 技术栈

| 层 | 技术 |
|---|------|
| 小程序 | Taro 4.2 + React 18 + TypeScript + SCSS |
| Web 前端 | Next.js 14 + TypeScript + Tailwind + shadcn/ui + vitest |
| 后端 | FastAPI + SQLAlchemy (async) + Pydantic v2 + Python ≥3.11 |
| 数据库 | PostgreSQL 15 + Redis 7 |
| 后台任务 | arq（衣物识别、通知推送、学习模型更新） |
| AI 文本 | 小米 MiMo API（OpenAI 兼容格式） |
| AI 虚拟试衣 | DashScope OutfitAnyone |
| 图像处理 | 阿里云视觉智能 + OSS |
| 天气 | 和风天气 v7（国内优先）+ Open-Meteo（fallback） |
| 电商 | 淘宝联盟 API |
| 认证 | 微信小程序登录 + OIDC |

## 三个子项目

- `backend/` — FastAPI 后端，入口 `app/main.py`，路由注册 `app/api/router.py`
- `frontend/` — Next.js Web 前端（暂未重点开发）
- `wechat-mini/` — Taro 微信小程序，入口 `src/app.ts`，路由配置 `src/app.config.ts`

## 常用命令

```bash
# === 构建 & 启动 ===
docker compose up -d --build          # 全部启动
.\sync-backend.cmd                    # 后端改代码后同步到容器（容器不挂载源码！）
cd wechat-mini && npm run build:weapp # 构建小程序（产物在 dist/）

# === 后端开发（本地热重载）===
docker compose stop backend worker
set PYTHONUTF8=1
cd backend && ..\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --env-file ../.env
# 另一终端启动 worker:
backend\.venv\Scripts\python.exe -m arq app.workers.worker.WorkerSettings

# === Lint & 格式化 ===
ruff check --fix backend/app/ && ruff format backend/app/   # 后端（line-length=100, py311）
cd frontend && npm run lint                                   # 前端 ESLint
cd frontend && npx tsc --noEmit                               # 前端类型检查

# === 测试 ===
docker compose exec backend python -m pytest tests/ -v --tb=short  # 后端测试
cd frontend && npm test                                              # 前端测试（vitest）

# === 数据库迁移 ===
docker compose exec backend alembic heads      # 查看所有 head（有多个！）
docker compose exec backend alembic upgrade <revision>  # 逐个执行每个 head

# === 健康检查 ===
curl http://localhost:8000/api/v1/health
```

## 重要约定 & 踩坑

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

Prompt 用英文指令（模型更易遵守），强制 `name`/`description` 用中文。后处理检测到英文描述会自动重写为中文。

### 天气服务链路

和风天气 v7（国内）→ Open-Meteo（海外 fallback）→ Redis 缓存降级（1h TTL）。
和风天气 icon 代码需映射到 condition，映射失败时使用 API 返回的中文 `text` 字段。

### 虚拟试衣链路

选衣物 → 智能分类（上装/下装/整套）→ 整套则 aitryon-parsing-v1 拆分 → DashScope aitryon-plus 异步提交 → 轮询 → 可选 aitryon-refiner 增强。全身照在 `BodyProfile.full_body_photo_url`。

### 淘宝联盟

无 API Key 时自动 Mock（8 个硬编码商品）。真实模式调用 `taobao.tbk.dg.material.optional.upgrade`，MD5 签名。

### 虚拟试衣任务存储

Task store 在内存中，重启丢失（后续可改 Redis）。

## Docker 服务

| 服务 | 容器 | 端口 |
|------|------|------|
| postgres | wardrobe-db | 5432 |
| redis | wardrobe-redis | 6379 |
| backend | wardrobe-backend | 8000 |
| worker | wardrobe-worker | — |
| frontend | wardrobe-frontend | 3000 |

数据卷：`postgres_data`、`redis_data`、`wardrobe_data`（图片）

## 关键文件速查

- `backend/app/services/virtual_tryon_service.py` — 虚拟试衣核心
- `backend/app/services/chat_service.py` — AI 对话逻辑
- `backend/app/services/recommendation_service.py` — AI 推荐引擎（含智能关键词、上下文感知）
- `backend/app/services/taobao_service.py` — 淘宝联盟集成
- `backend/app/services/learning_service.py` — 持续学习系统
- `backend/app/services/aliyun_vision_service.py` — 图像预处理
- `backend/app/prompts/` — AI Prompt 模板（中文）
- `backend/app/workers/worker.py` — arq 配置（7 job + 5 cron）
- `wechat-mini/src/constants/index.ts` — 中英文映射
- `wechat-mini/src/components/VirtualTryOnModal/` — 试衣 UI
- `wechat-mini/src/pages/suggest/index.tsx` — 搭配灵感（AI搭配 + 我的搭配 + 搭配灵感）
- `wechat-mini/src/pages/diy/index.tsx` — DIY 搭配画板
- `wechat-mini/src/pages/outfit-detail/index.tsx` — 搭配详情页

## AI搭配功能（本次新增）

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
3. 异步触发试穿图生成（使用基础 aitryon，非 aitryon-plus）
4. 前端轮询 `POST /outfits/batch-check` 获取试穿图
5. 试穿图使用 `aitryon` 基础模型（10-30秒），质量优先场景用 `aitryon-plus`

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

- 基础版（aitryon）：速度优先（10-30秒），用于AI搭配快速预览
- Plus版（aitryon-plus）：质量优先（30-60秒），用于虚拟试衣详情页
- 全身照来源：`BodyProfile.full_body_photo_url`，无则使用 `DEFAULT_PERSON_URL`

## 已知问题

- Docker 容器不挂载源码，改后端需 `.\sync-backend.cmd` 同步
- Alembic 有多个迁移头，需逐个 upgrade
- 会员支付未实现（UI 已就绪，显示"即将开放"）
- AI 推荐时偶尔返回文字编号而非数字（已实现容错跳过）
