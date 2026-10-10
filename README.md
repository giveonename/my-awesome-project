<h1 align="center">魔搭幻穿 · Wardrowbe</h1>

<p align="center">把整个衣橱装进微信 — 拍照录入、AI 搭配、虚拟试穿、越用越懂你</p>

---

**魔搭幻穿**是一个 AI 智能穿搭助手微信小程序。用户拍照上传衣物，AI 自动识别并建立"电子衣橱"，随后可以：

- 🤖 **AI 搭配** — 根据天气、场景、个人偏好与学习画像，一键生成多套穿搭方案
- 🪞 **虚拟试衣** — DashScope qwen-image-3.0 生成试穿效果图（原 OutfitAnyone 已于 2026-10 下线），支持整套着装与一键换背景
- 💬 **AI 造型师** — 多轮对话式穿搭咨询，推荐结果直接生成可交互的搭配卡片
- 🛍️ **搭配灵感** — 基于衣橱缺口或单件衣物智能生成搜索词，推荐淘宝商品
- 🧠 **持续学习** — 点赞/反馈/穿着记录反哺学习画像，推荐越用越准
- 📊 **衣橱洞察** — 穿搭统计、清洗提醒、风格分析

## 技术栈

| 层 | 技术 |
|---|------|
| 小程序 | Taro 4.2 + React 18 + TypeScript + SCSS |
| 后端 | FastAPI + SQLAlchemy (async) + Pydantic v2 + Python ≥3.11 |
| 数据库 | PostgreSQL 15 + Redis 7 |
| 后台任务 | arq（AI 识别、通知推送、学习画像更新） |
| AI 能力 | DeepSeek（文本/视觉理解）· DashScope qwen-image-3.0（虚拟试衣，原 OutfitAnyone 已于 2026-10 下线）· 阿里云视觉智能（图像分割） |
| 天气 | 和风天气 v7（国内优先）→ Open-Meteo（fallback）→ Redis 缓存降级 |
| 电商 | 淘宝联盟 API（未配置 Key 时自动 Mock） |
| 认证 | 微信小程序登录 |

## 架构

```
微信小程序 (Taro)
      │  HTTPS /api/v1
      ▼
FastAPI Backend ──► arq Worker ──► AI 服务（DeepSeek / DashScope / 阿里云视觉）
      │                                   │
      ├──► PostgreSQL 15                  └──► 本地图片存储（签名 URL，OSS 可选）
      └──► Redis 7（缓存 / 任务队列）
```

## 目录结构

```
wardrowbe/
├── backend/            # FastAPI 后端（app/api · models · services · workers · prompts）
├── wechat-mini/        # Taro 微信小程序（src/pages · components · utils）
├── docs/               # 项目文档（archive/ 内为历史方案与审计报告）
├── docker-compose.yml  # postgres / redis / backend / worker 四个服务
├── sync-backend.cmd    # 遗留工具：手动同步后端文件进容器（推荐改用镜像重建，见"后端开发"）
└── .env.example        # 环境变量模板
```

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 填写：SECRET_KEY、微信、AI、DashScope、阿里云、和风天气等 Key
```

### 2. 启动服务

```bash
docker compose up -d --build
docker compose ps   # 等待全部 healthy
```

### 3. 数据库迁移（重要）

迁移历史存在**多个 head**（详见"已知问题"），需要先查看再逐一升级：

```bash
docker compose exec backend alembic heads     # 查看所有 head
docker compose exec backend alembic upgrade <每个head的revision>   # 逐个执行
```

### 4. 验证

```bash
curl http://localhost:8000/api/v1/health   # {"status":"healthy"}
```

## 小程序开发

```bash
cd wechat-mini
npm install
npm run build:weapp     # 产物在 dist/，微信开发者工具导入 dist 目录
```

- `src/env.ts` 由 `get-local-ip.cjs` 在构建前自动生成（局域网 API 地址），真机预览需保证手机与后端同一局域网；生产构建需改为公网 HTTPS 域名（微信要求）。
- `project.config.json` 中的 `appid` 需替换为自己的小程序 AppID。

## 后端开发

推荐本地热重载（数据库/Redis 仍走 Docker）：

```bash
docker compose stop backend worker
set PYTHONUTF8=1
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --env-file ../.env

# 另一个终端启动 worker
backend\.venv\Scripts\python.exe -m arq app.workers.worker.WorkerSettings
```

> 若使用全容器模式（容器从镜像启动、不挂载源码）：改完后端代码后运行
> `docker compose up -d --build backend worker` 一步重建即可（镜像构建已配国内
> apt/pip 镜像源，速度很快）。`sync-backend.cmd` 是遗留的手动同步方式，已不推荐。

```bash
# 测试（需要正在运行的 PostgreSQL + Redis）
docker compose exec backend python -m pytest tests/ -v --tb=short

# Lint
ruff check --fix backend/app/ && ruff format backend/app/
```

## 已知问题与注意事项

- **数据库迁移多 head**：迁移图存在 5 个 head 且有一个重复的 revision ID（`a1b2c3d4e5f6`，Alembic 会告警但可加载）。升级请使用 `alembic heads` + 逐个 `upgrade`，切勿在未检查的情况下直接 `upgrade head`。
- **虚拟试衣任务存储在内存**：backend 重启后进行中的试衣任务会丢失（计划迁移 Redis）。
- **会员支付未实现**：UI 已就绪，点击显示"即将开放"。
- **通知通道为兼容保留**：ntfy/SMTP/Mattermost 是模板遗留配置，小程序端实际使用微信订阅消息路径。
- **图片服务已全面本地化**：浏览、识别、虚拟试衣（本地图 Base64 直传）与天气背景图（后端本地路由）均不依赖 OSS；OSS 仅与历史数据/公网部署相关。

## License

本项目基于 [Anyesh/wardrowbe](https://github.com/Anyesh/wardrowbe)（MIT License, Copyright © Anish S.）二次开发，遵循 MIT 协议开源，见 [LICENSE](LICENSE)。
