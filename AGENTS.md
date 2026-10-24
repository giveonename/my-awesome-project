# AGENTS.md — Wardrowbe（魔搭幻穿）

> AI 穿搭助手微信小程序：FastAPI 后端 + Taro/React 小程序
> 本文件是 AI 助手的权威工作文档；面向人的项目介绍见 `README.md`，历史方案见 `docs/archive/`。

## 技术栈

| 层 | 技术 |
|---|------|
| 小程序 | Taro 4.2 + React 18 + TypeScript + SCSS |
| 后端 | FastAPI + SQLAlchemy (async) + Pydantic v2 + Python ≥3.11 |
| 数据库 | PostgreSQL 15 + Redis 7 |
| 后台任务 | arq（衣物识别、试穿图生成/图库补货、通知推送、学习画像更新） |
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

# === Lint & 格式化（与 CI 同口径：整个 backend/，不只 app/）===
cd backend && ruff check --fix . && ruff format .   # line-length=100, py311；CI 固定 ruff==0.16.10

# === 测试（需要运行中的 PostgreSQL + Redis；conftest 每会话强制重建 wardrobe_test 并按 ORM 元数据建表）===
docker compose exec backend python -m pytest tests/ -v --tb=short
# 本地宿主机跑法（绕过容器内旧代码）：
# PYTHONUTF8=1 TEST_DATABASE_URL="postgresql+asyncpg://wardrobe:wardrobe@localhost:5432/wardrobe_test" REDIS_URL="redis://localhost:6379/0" backend/.venv/Scripts/python.exe -m pytest tests/ -q --tb=short

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
- 逐个 `alembic heads` → `upgrade <revision>` 只对「历史上增量打过」的库有效；**2026-10-24 实测从零建库走任何顺序都会在重复 revision 处炸 `KeyError: '_delete_version'`，迁移图已无法初始化全新环境**
- 线上库是靠逐个 upgrade 打上来的；新环境只能从生产库 dump 恢复，或像测试那样用 ORM `Base.metadata.create_all` 建表（`tests/conftest.py` 即此做法）；修复迁移图（线性化）属于高风险重构，需单独规划

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
- parse 响应回传实际分类 `scene_type`，前端据此切换「解析穿搭照/解析平铺图」标签（仅展示层；识别中显示为待定态）
- 历史教训：分类器曾在 2026-06 只存在于容器内从未入库，容器重建即丢失；本文件与仓库是唯一真相，勿再只在容器里改代码

### 用户头像与昵称

- 头像经 `POST /users/me/avatar` 上传，**DB 存相对路径、每次响应重新签名**（`_resolve_avatar_url`），避免签名 URL 过期；旧本地头像文件会被尽力清理
- 昵称（`display_name`）经 `PATCH /users/me` 修改，1-20 字、自动去首尾空格
- 前端编辑入口在"我的"页头部（EditProfileSheet 弹窗）：头像用微信 `open-type="chooseAvatar"`、昵称用 `input type="nickname"`（2022 后微信唯一合规路径，不可静默获取）

### 搭配图库与后台任务（2026-10，用户无感架构）

- **试穿图生成在 arq worker**（`app/workers/tryon.py`）：`generate_outfit_tryon`（单套）与 `replenish_suggest_pool`（图库补货）；进程内 Semaphore(1) 串行 + 限流退避重试。这两个 job 用 `arq.func(..., timeout=)` 单独放宽了超时（3600s / 7200s）——全局 600s 曾在 2026-10-13 腰斩过补货任务（created 4 / generated 0 / 无通知）。**worker 容器需要 DASHSCOPE_* 环境变量**（compose 已配）
- **图库模式（2026-10-13 起，池子语义已变）**（`app/services/suggest_pool.py`）：
  - 图库 = `created_at >= suggest_library_since`（默认 2026-10-01）+ 有试穿图 + 挂至少一件衣物 的 AI 搭配（source=on_demand）
  - **没有"未展示"排除**：看过的留在库里，按**最久没看优先**轮换（取图时写入 `suggest:seen` 台账）→ 库 20+ 张时日常 0 生成、0 花费
  - **人像指纹**（`suggest:person`）：生成时记录"这张图用的是哪张人物照"（按图片内容哈希）；取图只取与**当前**人物照一致的 → 换模特后老图自动退场，库变空时首页 prewarm 自动补新图（自愈）
  - 台账全在 Redis（**刻意不加表**——迁移图损坏）
- **接口**：`GET /outfits/feed`（秒取 2 套，可带 `occasion`）；`POST /outfits/prewarm`（幂等补水：库 < target=4 且当日预算未用完才入队；每日预算帽 `suggest_daily_batch_budget` 默认 2 批）
- **交互试穿结果自动入库**（`api/virtual_tryon.py::_keep_tryon_result`）：每次单件/多件试穿完成后，结果存成图库搭配（带衣物 + 人像指纹），**不写已展示台账** → 作为最新未看项排在轮换**队首**，下一波 feed 第一张就是它
- **应用内通知**（`app/services/inapp_notice_service.py`，Redis 7 天 TTL，`push_notice(..., extra=)` 可带附加字段）：首页社区横幅**插播** 🔔（排轮播第一位）；`target` 决定点击跳转：`suggest`（搭配页）/ `wardrobe`（衣橱）。**刻意不用 Notification 表**（那张表的出站重试 cron 会试图"投递"）
  - `suggest_ready`：图库补货完成（附 occasion）
  - `tryon_ready`：交互试穿完成（标题带衣物名）；首页读到它会写 `suggest_force_refresh` 标记 → **搭配页进入时复位场景 + 强制刷新**，保证第一波就能看到刚生成的结果
  - `items_ready`：一批衣物打标全部完成（worker：无剩余处理中衣物时才发）→ 覆盖"上传后离开页面"
- **前端**：首页 onShow 静默 `prewarm`；搭配页每批 2 套**竖版大图卡**（试穿图置顶全宽、≥4 件衣物缩略图自动折 2×2；仅 1 套时全宽单卡），**只有点「换一批推荐」才取下一组**（没有滚动追加）；图库见底才弹「先去逛逛／就在这看看」+ 20 秒轮询（兜底）
- **成本控制**：库足时不生成；应急关闸 = 调小 `SUGGEST_DAILY_BATCH_BUDGET`

### 图片签名 URL 约定（2026-10-13 修复双重签名）

- **DB 只存裸路径**（`{user_id}/{filename}`）；响应一律用 `sign_image_url()` 现场签名
- `sign_image_url` **幂等**：会自动剥离 `/api/v1/images/` 前缀与旧 query 再重签；绝对 http（历史 OSS）原样放行 —— 因此存量"已签名 URL"不需要数据迁移
- 历史 bug：`model_image_url` 存的就是签名 URL，序列化时又签一次 → `/api/v1/images//api/v1/images/...?expires=..&sig=..?expires=..&sig=..` → 小程序下载失败（试穿图全白）
- 写入端（试穿结果、DIY 穿搭照、全身照）用 `bare_image_path()` 归一化后再入库

### 小程序踩坑合集（2026-10-13 集中修复，都是可复发的类型）

- **子组件里的页面级生命周期时机**：`useDidShow` / `useReachBottom` 这类页面级 hook 放在**条件渲染的子组件**里时，只能收到"组件挂载之后"的事件——用户先开页面再切标签时，这一次的 `useDidShow` 收不到 → loading 卡死在初始值（白屏）。修法：子组件**挂载时自己加载一次**（`useEffect`），页面级刷新靠父组件传 key 重挂载
- **Pydantic schema 漂移**：模型里有字段、但 `XxxUpdate` / `XxxResponse` 漏了它 → 保存被静默丢弃、读取永远为空。已修：`style_identity`、`gender` / `age_range` / `profession_scene`（个人档案页的"存了但回显空白"就是这个）
- **前端接口路径写错不会报编译错**：只能在真机表现为"操作失败"。例：记录清洗写成 `/items/{id}/log-wash`（真实是 `/wash`）→ 404。改接口调用前先对着后端路由核一遍
- **枚举取值两端要对齐**：温度敏感度前端发 `cold/hot`、后端只收 `low/normal/high` → 422 整个保存失败（风格偏好页）
- **自定义 Tab 栏盖住底部弹窗**：自定义 tabBar 由框架渲染在页面之上（z-index 9999），**页面里的弹窗无法覆盖它** → 底部弹窗必须留出 140rpx + `env(safe-area-inset-bottom)` 的底部内边距（排序弹窗曾因此被截断）
- **`<textarea>` 必须显式写 `line-height`**：否则行盒比字号还矮，字符上半截被裁（单行 `<input>` 会自动居中所以看不出）
- **`aspect-ratio` 在部分 webview 不生效**：商品卡图片区用它做等比会高低不齐，改成固定高度（rpx）
- **衣橱页整页滚动**：顶层 `min-height: 100vh` + 内部滚动区 `calc(100vh - 200rpx)` 会让整页比屏幕高、返回时顶部区块被 WebView 留白 → 正确写法：顶层 `height: 100vh` + flex 纵向 + 滚动区 `flex: 1`（顺带：返回本页时让顶部区块换 key 重挂载一次，强制重绘）

### 天气服务链路

和风天气 v7（国内）→ Open-Meteo（海外 fallback）→ Redis 缓存降级（1h TTL）。
和风天气 icon 代码需映射到 condition，映射失败时使用 API 返回的中文 `text` 字段。

### 虚拟试衣链路（2026-10 迁移至 qwen-image-3.0）

选衣物 → `resolve_tryon_inputs`（整套 outfit 直接整图当参考、不再拆分；否则**取上装+下装，最多 2 件**）→ 本地图片转 Base64（**不依赖 OSS**）→ `build_tryon_prompt` 按衣物元数据生成四段式提示词（保持人物/穿着服装/成片要求/禁止；长度属性交由商品图，勿写死）→ DashScope **qwen-image-3.0** 同步生成（约 80-100 秒、0.18 元/张，繁忙时限流退避重试可拖到近 10 分钟）→ 下载结果转存本地（官方链接 24h 失效）。

- **API 硬限制：图片总数 ≤3 张**（人物占 1 张 → 衣物最多 2 件）。实测直传 3 件衣物会被拒：`InvalidParameter: supports 0~3 image content items. Got 4 image items`。想覆盖更多件（鞋/外套）需**两段式生成**（第一遍上装+下装 → 第二遍拿结果图+第 3 件再生成），已实验验证可行（¥0.36/套），**尚未接入**，属待定项
- `/submit` 在后台 asyncio 任务执行，`/status` 读内存任务表；**前端弹窗轮询窗口已放宽到 15 分钟**（原 4 分钟会在 qwen 繁忙时"前端报失败、后台其实成功"）；完成后结果自动入图库（见上）
- 批量试穿图生成在 arq worker 串行执行 + Throttling 退避重试（见『搭配图库与后台任务』）
- 另有 `swap_background`（SegmentBody 抠图 + PIL 合成，模板图在 `backend/app/assets/backgrounds/`）；全身照在 `BodyProfile.full_body_photo_url`，无则回退 `DEFAULT_PERSON_URL`
- 天气背景图走本地路由 `/weather/backgrounds/{name}`（素材目录 `backend/app/assets/weather-bg/`，6 张图已入库；缺失时前端自动渐变兜底）

### 淘宝联盟（商品灵感页）

无 API Key 时自动 Mock（约 35 个硬编码商品）。真实模式调用 `taobao.tbk.dg.material.optional.upgrade`，MD5 签名（仓库已配 Key，走真实 API）。

**画像化推荐（2026-10-13）**——关键词与结果都按用户画像收敛：
- 关键词构造 `_personalize_keyword`：缺性别词时自动补「男士/女士」前缀；按身高（≥178 加长、≤165 九分）与 BMI（<18.5 修身、≥24 宽松）追加**版型限定词**（体型词表是女装语境，只对女性用户生效）
- **结果质量闸门** `_apply_profile_gate`：剔除与画像矛盾的商品（男用户去掉「女装/连衣裙/高跟鞋」等，所有人去掉「童装/中老年/妈妈装」）；严格过滤过少时先用**无性别标记的中性商品**回填，最后才软过滤
- **分性别词表**：自动模式的回退词表、补全搭配的品类词表都按性别分流（原来只有女装词表）
- 接口返回 `reason`（人话理由，如「最近上衣穿得比较重复 · 关键词适配「男士」」），前端渲染成理由行 + 卡片短理由（「为你挑」/「补缺 · 鞋子」/「搭「X」」）
- 调试看 `keyword_used`（原始关键词，仅排查用，不再展示给用户）

### 衣橱管理：待洗 / 收藏 / 衣橱价值（CPW）

- **待洗是自动算的**：每件衣物有洗涤周期（`DEFAULT_WASH_INTERVALS`，按 type；可被 `wash_interval` 覆盖）；点「今天穿了」→「距上次清洗的穿着次数」+1，≥ 周期即自动待洗；「洗了 / 记录清洗」清零。worker 每 6 小时 `check_wash_reminders` 巡逻并推送提醒
- **手动管理**（2026-10-13 新增）：长按衣物菜单「标记待洗 / 取消待洗」（标记时会把穿着次数补到周期值，否则下次穿着会被自动规则清掉；取消视同已洗）；管理模式多选「标记已洗」；「待洗」筛选下「全部标记已洗」
- **接口**：`POST /items/{id}/wash`（记录清洗，**注意不是 `/log-wash`**）；`POST /items/bulk/needs-wash` `{item_ids, needs_wash}`；`POST /items/bulk/wash` `{item_ids}` 或 `{all_needs_wash: true}`
- **计数口径**：顶部「全部/收藏/待洗」走 `GET /items/stats`（与分页无关）；三个格子可点击筛选（`favorite=true` / `needs_wash=true`），当前项高亮
- **衣橱价值 CPW**：衣物详情「编辑」可填「购买价格」；详情页显示单次穿着成本（价格 ÷ max(穿着次数,1)）；衣橱统计页「衣橱价值」卡片显示总投入与平均单次成本；排序弹窗「按穿着成本排序」= `价格 / GREATEST(穿着次数,1)` 升序（没填价格的排最后）

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
- `backend/app/services/suggest_pool.py` — 搭配图库（选图轮换 / 人像指纹 / 预算 / 台账）
- `backend/app/workers/tryon.py` — arq 试穿任务（单套生成 / 图库补货，per-function 超时）
- `backend/app/utils/signed_urls.py` — 图片签名（幂等 `sign_image_url` / `bare_image_path`）
- `backend/app/services/inapp_notice_service.py` — 应用内通知（Redis 列表 + extra 附加字段）
- `backend/app/services/chat_service.py` — AI 对话逻辑（人设"小衣"）
- `backend/app/services/recommendation_service.py` — AI 推荐引擎（含智能关键词、上下文感知）
- `backend/app/services/learning_service.py` — 持续学习系统
- `backend/app/services/aliyun_vision_service.py` — 图像预处理/分割
- `backend/app/services/taobao_service.py` — 淘宝联盟集成
- `backend/app/api/products.py` — 商品灵感（画像化关键词 `_personalize_keyword` + 质量闸门 `_apply_profile_gate`）
- `backend/app/prompts/` — AI Prompt 模板（5 个，UTF-8 无 BOM）
- `backend/app/workers/worker.py` — arq 配置（job 列表 + cron + per-function 超时）
- `wechat-mini/src/utils/api.ts` — 请求封装（token、401 跳登录、错误中文化）
- `wechat-mini/src/constants/index.ts` — 中英文映射
- `wechat-mini/src/constants/icons.ts` — 内联 base64 图标（约 130KB，由 gen-icons.cjs 生成）
- `wechat-mini/src/components/VirtualTryOnModal/` — 试衣弹窗（suggest/item-detail/diy/wardrobe 共用）
- `wechat-mini/src/components/OutfitCardEnhanced/` — AI 搭配卡（solo/solo-wide 竖版大图变体）
- `wechat-mini/src/components/ProductCard/` — 商品卡（固定图高 + 可搭配行）
- `wechat-mini/src/pages/suggest/index.tsx` — 搭配灵感（AI搭配 + 我的搭配 + 搭配灵感）
- `wechat-mini/src/pages/parse/index.tsx` — 统一上传识别页（平铺图/穿搭照双 tab）
- `wechat-mini/src/pages/diy/index.tsx` — DIY 搭配画板
- `wechat-mini/src/pages/wardrobe/index.tsx` — 衣橱（双衣橱 tab / 统计筛选 / 长按菜单 / 管理模式）
- `wechat-mini/src/pages/profile-settings/index.tsx` — 个人档案（基本信息 / 身材数据 / 风格偏好）

## AI搭配功能

### 架构概述

```
搭配灵感页面（suggest/index.tsx）
├── Tab 1: 我的搭配 — 用户DIY创建的搭配（source=manual；挂载时自加载 + 父级 key 刷新）
├── Tab 2: AI搭配  — 从图库秒取 2 套（见『搭配图库与后台任务』）
└── Tab 3: 搭配灵感 — 淘宝商品推荐（画像化关键词 + 质量闸门）
```

### AI搭配核心流程（图库模式，2026-10-13 起）

1. 首页 onShow 静默 `POST /outfits/prewarm`（库 < 4 且预算未用完才补货）
2. 搭配页 `GET /outfits/feed` 秒取 2 套（带图 + 挂衣物 + 与当前人物一致 + 按最久没看优先）
3. 只点「换一批推荐」取下一组；图库见底弹窗兜底（生成中 → 20 秒轮询 → 就绪 toast + 刷新）
4. 后台补货完成 / 交互试穿完成 / 衣物识别完成 → 首页横幅 🔔 插播通知

> 旧流程 `POST /outfits/suggest-batch`（一次 6 套 + `batch-check` 轮询）为遗留接口，主流程已不用；其 Mode A 复用查询必须带 `selectinload`（历史 MissingGreenlet 事故）

### 我的搭配核心流程

1. 用户在 DIY 页面创建搭配 → `POST /outfits/studio`
2. 搭配存储为 `source=manual` 的 Outfit 记录
3. 前端通过 `GET /outfits?source=manual` 加载
4. 支持场景筛选、设定场景、上传穿搭照
5. 搭配详情页「删除」对 AI 搭配同样开放：删除会连带清理该套的图片文件（仅 AI 生成图）与 Redis 台账；**有穿着记录的搭配拒绝删除**（保护穿搭日历）

### 关键数据区分

| 数据类型 | source_scene | tryon_ready | 说明 |
|----------|--------------|-------------|------|
| 电子衣橱 | `commodity` | `false` | 用户上传的平铺衣物照片 |
| 试衣间 | `avatar` | `true` | 用户上传的穿搭照/全身照 |

### 虚拟试衣参数

- 模型：`qwen-image-3.0`（单一模型；0.18 元/张、约 80-100 秒。原 aitryon 基础版/Plus 双模型方案随 2026-10 下线废弃）
- 全身照来源：`BodyProfile.full_body_photo_url`，无则使用 `DEFAULT_PERSON_URL`

## 已知问题

- **数据库迁移图损坏**（见上"重要约定"），5 head + 重复 revision ID；新环境**无法**靠迁移图从零初始化（重复 revision 会让 upgrade 炸 KeyError），需从生产库 dump 恢复或用 ORM create_all（测试库的做法）
- Docker 容器从镜像启动（不挂载源码）：改后端代码用 `docker compose up -d --build backend worker`（优选）；`sync-backend.cmd` 为遗留手动同步方式（曾导致容器与仓库代码漂移），不再推荐
- 背景移除：rembg 已退役（`background_removal.py` 中 rembg 走桩会转阿里云）；`BG_REMOVAL_PROVIDER` 有效值为 `aliyun`（推荐）或 `http`
- 图片服务已全面本地化：浏览/识别/试衣（本地图 Base64）/天气背景均不依赖 OSS；OSS 停服仅影响历史 public_url 与公网部署场景
- 虚拟试衣任务存内存，backend 重启丢失（后续可改 Redis）
- 交互试穿若要覆盖 3 件以上（如加鞋/外套），需走**两段式生成**（见『虚拟试衣链路』），尚未接入
- 「我的搭配」tab 的刷新依赖父级 key 重挂载（历史 bug：子组件 useDidShow 收不到首次显示事件 → 白屏）
- 会员支付未实现（UI 已就绪，显示"即将开放"）
- AI 推荐时偶尔返回文字编号而非数字（已实现容错跳过）
- `ootd` 页面（每日穿搭：真实天气+7天预报+穿搭记录）入口在首页"今日穿搭"卡片；`history` 穿搭日历另有首页金刚区与个人页两个入口
- 小程序 SCSS 全量使用 `@import`（Dart Sass 3.0 将移除；当前 sass 锁 1.86，构建仅有警告、无风险）：迁 `@use` 属技术债，涉及全部 scss 文件且需排版回归，待后续专项处理
- 小程序多页存在 `<ScrollView>` 直接设置 padding 的旧写法（chat/diy/suggest/profile-settings 共 6 处；微信 WebView 渲染模式对 scroll-view padding 仅部分支持，devtools 会告警）：新代码规范 = padding 放内层容器（如 home 的 capsules-list）；存量迁移属技术债，改动需逐页视觉回归
- 小程序 `suggest/index.tsx` 超过 1300 行、`api/items.py` 超过 2100 行，属技术债，改动时注意局部化
- 仓库 git remote 此前指向模板仓库 Anyesh/wardrowbe，已于 2026-10 断开；推送前需自行 `git remote add origin <你的仓库>`
