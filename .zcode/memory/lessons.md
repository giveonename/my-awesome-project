---
summary: 踩坑记录:现象、根因与规避方式
created: 2026-10-13 11:49
updated: 2026-10-13 11:53
status: active
---

# 教训

<!-- 踩过的坑:现象 → 根因 → 修复/规避方式。未经验证的猜测不写。格式: -->

<!-- - [YYYY-MM-DD] **现象一句话**:根因;规避:做法 -->

- [2026-10-07] **容器与仓库代码漂移（本阶段最大坑）**：旧镜像 + sync-backend.cmd 手动补丁导致容器跑 6 月代码（signed_urls 含 ngrok 化石、oss_service 模块丢失、AI 分类器只存在于容器内）。根因：容器不挂载源码且补丁不持久；规避：一律 `docker compose up -d --build backend worker` 重建，弃用 sync-backend.cmd
- [2026-10-12] **SQLAlchemy MissingGreenlet（两处连环爆发）**：async 会话中访问未 eager load 的关系即抛错。suggest-batch Mode A（50% 随机复用已有搭配）的查询无 options、数据长齐后才被激活；规避：查询统一 `selectinload(Outfit.items→item, feedback, family_ratings)`，且 `Outfit.feedback` 关系设为 `lazy="selectin"` 全局兜底
- [2026-10-12] **qwen-image-3.0 并发配额严格**：6 套搭配并行生成全部被 `Throttling.RateQuota` 打灭（旧 aitryon 异步提交扛得住并发）。规避：批量生成串行（Semaphore(1)）+ 检测 Throttling 自动退避重试（20/40s，≤3次）
- [2026-10-12] **arq 入队漏 `_queue_name="arq:tagging"`**：任务进默认队列，worker 永不消费（表现为"任务消失了"，排查 4 轮才揪出）。规避：所有 `enqueue_job` 必须带队列名，参照 `api/items.py` 既有写法
- [2026-10-12] **试衣生成搬进 worker 的两个连环坑**：① worker 容器缺 `DASHSCOPE_*` 环境变量（compose worker 段漏配）→ 报"API key not configured"；② `get_db_session(ctx)` 是**同步函数**，`await` 它报 TypeError。均已修复（compose 已补三段环境变量）
- [2026-10-12] **微信 2022 头像昵称政策**：`wx.getUserProfile` 已回收，头像只能 `button open-type="chooseAvatar"`、昵称只能 `input type="nickname"`（不可静默获取）。登录时昵称默认为"微信用户+openid尾号"
- [2026-10-09] **Docker 构建在国内网络必须换源**：Docker Hub 拉底座超时、apt 官方源 28 分钟/20 包、pip 装 rembg 新版要 1GB 模型（19KB/s 一天下不完）。规避：daemon.json 配 registry mirror + Dockerfile 用阿里云 apt/pip 源；rembg 已整体退役删除
- [2026-10-11] **sass 弃用警告里的乱码字符 = scss 的 UTF-8 BOM**（10 个文件）；`@import` 弃用警告本身无害（sass 锁 1.86），迁 `@use` 属技术债。scroll-view 的 padding 在 webview 渲染模式仅部分支持，规范是 padding 放内层容器
- [2026-10-13] **bash 工具陷阱三连**：含三重引号的大段 Python 用 heredoc 会被撕裂（写成脚本文件最稳）；`grep -c` 结果为 0 时退出码 1 会断 `&&` 链（用 `;` 连接）；`Write` 工具覆写已存在文件需先 Read
