---
summary: 项目目标、结构与进行中任务
created: 2026-10-13 11:49
updated: 2026-10-13 11:53
status: active
---

# 项目状态

## 目标

魔搭幻穿（Wardrowbe）：本科毕设项目（贵州师范大学），AI 穿搭助手微信小程序。基于开源模板 Anyesh/wardrowbe 二次开发，模板 Web 端已移除，仅小程序 + FastAPI 后端活跃。核心能力：电子衣橱/试衣间双衣橱、AI 搭配推荐、qwen-image-3.0 虚拟试衣、AI 对话（小衣）、持续学习画像。已有论文材料 `thesis-context.md`（本地、未入库）。

## 结构

- `backend/` — FastAPI + SQLAlchemy async + arq worker；路由 `app/api/`（17 模块 / 136 端点）；服务 `app/services/`；后台任务 `app/workers/`（9 job + 5 cron）
- `wechat-mini/` — Taro 4.2 + React 小程序（22 页面 / 4 组件）；请求封装 `src/utils/api.ts`
- `.zcode/memory/` — 本记忆库（由 /handoff 维护，必须随仓库进 git）
- `AGENTS.md` = AI 权威工作文档；`docs/archive/` = 历史文档归档
- 部署：docker compose 四服务（postgres/redis/backend/worker）；镜像构建走国内源
- 图片：本地存储卷 + HMAC 签名 URL，全面去 OSS 依赖（试衣输入走 Base64）
- AI：DeepSeek（文本+视觉，deepseek-flash）、DashScope qwen-image-3.0（试衣）、阿里云视觉智能（分割）

## 进行中

- [2026-10-12] 搭配池 P1（无感预生成）已实现待用户验收 | 进行中：等用户在开发者工具走完整链路 | 卡点：无
- [2026-10-12] P2 上传识别"可离开+通知" | 待确认 | 前置：解析任务持久化（DB 或 Redis）
- [2026-10-12] git remote 未配置，161 提交仅存本地 | 待处理 | 卡点：需用户提供仓库地址
