---
summary: 环境约束、关键路径与可复用命令
created: 2026-10-13 11:49
updated: 2026-10-13 11:53
status: active
---

# 事实

## 环境

- [2026-10-13] Windows 11 + Git Bash；Docker Desktop 已配 4 个国内 registry mirror（`C:\Users\Jason\.docker\daemon.json`）；backend Dockerfile 走阿里云 apt/pip 源
- [2026-10-13] gh CLI 不可用；仓库**无 git remote**（origin 曾指向模板 Anyesh/wardrowbe，已断开）
- [2026-10-13] 容器内日志时间为 UTC，宿主本地为 UTC+8；当前项目时间基准 2026-10
- [2026-10-13] 记忆库两套并存：仓库级 `.zcode/memory/`（本库）+ 系统级 `C:\Users\Jason\.zcode\cli\memories\projects\wardrowbe-2266f363e6029c28\memory\`

## 路径与位置

- [2026-10-13] 环境变量以**根目录 `.env`** 为准：compose 注入优先于 backend/.env（pydantic 优先级）；本地热重载也需 `--env-file ../.env`。改配置永远改根 .env，改完 `docker compose up -d backend worker`（重建容器，restart 不重读 env）
- [2026-10-13] 图片存储：容器卷 wardrobe_data → `/data/wardrobe/`（用户图 + 试穿结果）；天气背景素材 `backend/app/assets/weather-bg/`（6 张）；换背景模板 `backend/app/assets/backgrounds/`
- [2026-10-13] 小程序 `src/env.ts` 由 get-local-ip.cjs 在 predev/prebuild 自动生成（局域网 IP，会变），勿手改
- [2026-10-13] 迁移文件 `backend/migrations/versions/`（24 个）：**5 head + 重复 ID `a1b2c3d4e5f6`**，新迁移极难安全追加，优先用 Redis/复用现有表绕过 schema 变更

## 命令与操作

- [2026-10-13] 后端部署（首选）：`docker compose up -d --build backend worker`（worker 也要重建——试衣生成在 worker；镜像已配国内源，构建快）
- [2026-10-13] 小程序构建：`cd wechat-mini && npm run build:weapp`（webpack 持久缓存已开，重复构建 <1s；异常时清 `node_modules/.cache`）
- [2026-10-13] 后端测试：`docker compose exec backend python -m pytest tests/ -v --tb=short`（需 Postgres+Redis）
- [2026-10-13] 迁移操作：**先 `alembic heads`** 逐个 `upgrade <rev>`，禁用 `upgrade head`
- [2026-10-13] 接口验证法（无 UI 时）：容器内 `create_access_token(user.external_id)` 签发 token + httpx 打 `http://localhost:8000/api/v1`；测试数据用后清理并还原
- [2026-10-13] 大段 Python **写成脚本文件执行**（bash heredoc 会撕裂含三重引号的脚本）；`grep -c` 计数 0 时退出码 1，会断 `&&` 链（用 `;`）
- [2026-10-13] 修改后端文件后要判断影响进程：backend 的 uvicorn **不会热加载**（需 restart 或重建）；worker 同理；`docker cp` 文件后必须 restart 对应容器
