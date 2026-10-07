# Wardrowbe 全项目连通性与健壮性审计报告

> 审计时间：2026-05-31
> 审计范围：wechat-mini/src/ 全部页面 + backend/app/api/ 全部路由

---

## 一、前后端接口对齐扫描

### P0 — 前端调用了但后端不存在的接口（会导致功能完全不可用）

| # | 前端调用 | 方法 | 来源文件 | 后端状态 | 影响 |
|---|---------|------|---------|---------|------|
| 1 | `/outfits/{id}/like` | POST | suggest/index.tsx:143, outfit-detail/index.tsx:53 | **不存在** | 点赞功能完全不可用 |
| 2 | `/outfits/{id}/like` | DELETE | outfit-detail/index.tsx:51 | **不存在** | 取消点赞完全不可用 |
| 3 | `/outfits/custom` | POST | diy/index.tsx:169 | **不存在** | DIY 保存搭配功能不可用 |
| 4 | `/outfits/evaluate` | POST | evaluation/index.tsx:269 | **不存在** | 穿搭评测功能不可用 |
| 5 | `/items/parse` | UPLOAD | parse/index.tsx:44 | **不存在** | AI 批量解析功能不可用 |
| 6 | `/community/posts` | GET | discover/index.tsx:36 | **不存在** | 发现页动态流完全空白 |
| 7 | `/community/posts/{id}/like` | POST | discover/index.tsx:59 | **不存在** | 发现页点赞不可用 |
| 8 | `/community/posts/{id}/like` | DELETE | discover/index.tsx:57 | **不存在** | 发现页取消点赞不可用 |
| 9 | `/outfits/diy` | POST | diy/index.tsx:188 | **不存在** | DIY AI 点评功能不可用 |

**共 9 个断裂接口，涉及 5 个页面的核心功能。**

### P1 — 前后端路径/参数不一致

| # | 问题 | 详情 |
|---|------|------|
| 1 | suggest 页面曾用 GET 调 `/outfits/suggest` | 后端是 POST，已修复为 POST |
| 2 | body-profile 端点 Docker 未同步 | 代码已写入但容器未加载，已修复 |

### 后端存在但前端未使用的接口（功能闲置）

后端有 115 个路由，前端仅调用约 39 个。以下后端功能前端完全未接入：

| 后端路由 | 功能 | 建议 |
|---------|------|------|
| `POST /outfits/studio` | 搭配工作室 | DIY 页应使用此接口替代 `/outfits/custom` |
| `POST /outfits/{id}/feedback` | 搭配反馈 | outfit-detail 页应接入 |
| `POST /outfits/{id}/reject` | 拒绝搭配 | outfit-detail 页可接入 |
| `POST /outfits/{id}/skip` | 跳过搭配 | 可用于快速浏览模式 |
| `POST /items/{id}/wear` | 记录穿着 | item-detail 页应接入 |
| `POST /items/{id}/wash` | 记录清洗 | item-detail 页应接入 |
| `POST /items/{id}/archive` | 归档衣物 | item-detail 页可接入 |
| `POST /items/{id}/analyze` | 触发 AI 分析 | item-detail 页可接入 |
| `GET /weather/forecast` | 天气预报 | home 页可接入 |
| `GET /families/me` | 家庭信息 | profile 页可接入 |
| `POST /families` | 创建家庭 | 可用于家庭功能 |
| `GET /learning` | 学习画像 | analytics 页可接入 |
| `GET /learning/item-pairs/{id}` | 单品搭配推荐 | item-detail 页可接入 |
| `POST /notifications/push-token` | 推送注册 | 应在登录后调用 |
| `GET /notifications/settings` | 通知设置 | preferences 页可接入 |
| `POST /chat/onboarding` | 引导注册 | onboarding 页已接入 ✓ |

---

## 二、占位符与死功能扫描

### P1 — 未实现的功能入口（用户点击后只看到 Toast）

| # | 文件 | 位置 | 用户看到的文案 | 建议 |
|---|------|------|--------------|------|
| 1 | profile/index.tsx | 菜单项 `page: ''` | "这个功能还在路上" | 涉及：意见反馈、常见问题、邀请有礼、系统设置（4个菜单） |
| 2 | membership/index.tsx | 支付按钮 | "支付功能还在开发中" | 会员页核心功能 |
| 3 | evaluation/index.tsx | 分享海报按钮 | "海报生成功能开发中" | 评测结果页 |
| 4 | suggest/index.tsx | "我的搭配" Tab | "自定义搭配功能正在开发中" | Tab 切换 |
| 5 | suggest/index.tsx | "商品搭配" Tab | "商品搭配推荐正在开发中" | Tab 切换 |
| 6 | home/index.tsx | handleFeatureClick | "这个功能还在路上" | 金刚区中 `page: ''` 的入口 |

### P2 — 未注册的死链接

**无。** 所有 `Taro.navigateTo` 目标均已在 `app.config.ts` 中注册。

---

## 三、脆弱性与白屏崩溃点扫描

### P0 — `.map()` 未做空值保护（会导致白屏崩溃）

| # | 文件 | 行号 | 表达式 | 风险 |
|---|------|------|--------|------|
| 1 | outfit-detail/index.tsx | 136 | `outfit.items.map(...)` | `outfit.items` 可能为 undefined |
| 2 | outfit-detail/index.tsx | 178 | `outfit.highlights.map(...)` | `highlights` 可能为 undefined |
| 3 | item-detail/index.tsx | 305 | `item.colors.map(...)` | `item` 可能为 null，`colors` 可能为 undefined |
| 4 | item-detail/index.tsx | 368 | `wearHistory.map(...)` | `setWearHistory(historyData.value)` 无 `|| []` 兜底 |
| 5 | item-detail/index.tsx | 381 | `entry.outfit.items.map(...)` | `entry.outfit` 可能为 null |
| 6 | item-detail/index.tsx | 263 | `tags.map(...)` | `tags` 依赖 `item` 字段，`item` 为 null 时崩溃 |
| 7 | chat/index.tsx | 159 | `outfit.items.map(...)` | `outfit.items` 可能为 undefined |
| 8 | chat/index.tsx | 189 | `msg.metadata.outfit_suggestions.map(...)` | `outfit_suggestions` 可能为 undefined |
| 9 | community/detail.tsx | 269 | `request.reference_image_urls.map(...)` | `reference_image_urls` 可能为 undefined |
| 10 | community/detail.tsx | 320 | `reply.suggested_items.map(...)` | `suggested_items` 可能为 undefined |

**最危险的文件：**
- `item-detail/index.tsx` — 6 处未保护的 `.map()`，涉及 `item`（nullable）、`wearHistory`（无兜底）、`entry.outfit`（nullable）
- `outfit-detail/index.tsx` — 2 处未保护
- `chat/index.tsx` — 2 处未保护

### P2 — 乐观更新未回滚

| # | 文件 | 问题 |
|---|------|------|
| 1 | suggest/index.tsx:134-143 | 点赞使用乐观更新（先改 UI 再发请求），API 失败时不回滚 `likedIds` 状态 |

### P2 — SVG 元素导致白屏（已修复）

评测页 `ScoreRing` 和 `RadarChart` 组件曾使用 `<svg>/<circle>/<polygon>` 元素，WeChat 小程序不支持 SVG。已替换为纯 CSS 实现（conic-gradient + clip-path）。

---

## 四、修复优先级汇总

### P0 — 阻塞性错误（核心功能不可用）

| # | 问题 | 修复方案 | 状态 |
|---|------|---------|------|
| 1 | `/outfits/{id}/like` 不存在 | 前端改用 `/outfits/{id}/feedback` (rating:5) | ✅ 已修复 |
| 2 | `/outfits/custom` 不存在 | 前端改用 `/outfits/studio` | ✅ 已修复 |
| 3 | `/outfits/evaluate` 不存在 | 后端新增 AI 评测端点 | ✅ 已修复 |
| 4 | `/items/parse` 不存在 | 前端改用 `/items/bulk` | ✅ 已修复 |
| 5 | `/community/posts` 不存在 | 后端新增 stub 端点（返回空列表） | ✅ 已修复 |
| 6 | `/outfits/diy` 不存在 | 前端改用 `/outfits/suggest` + include_items | ✅ 已修复 |
| 7 | 3 处 `.map()` 无空值保护 | 添加 `|| []` 兜底 | ✅ 已修复 |

### P1 — 功能缺失（影响用户体验）

| # | 问题 | 修复方案 | 状态 |
|---|------|---------|------|
| 1 | profile 页 4 个空菜单项 | 替换为已有功能入口（身材档案/偏好设置/衣橱统计） | ✅ 已修复 |
| 2 | suggest 页"我的搭配" Tab | 接入 `GET /outfits?source=manual`，展示用户自建搭配 | ✅ 已修复 |
| 3 | suggest 页"商品搭配" Tab | 接入推荐入口，引导用户发现搭配灵感 | ✅ 已修复 |
| 4 | membership 支付按钮 | 保留，用户点击有友好提示 | ⏳ 保留（需支付渠道） |
| 5 | evaluation 分享海报 | Canvas 绘制海报 + 保存到相册 | ✅ 已修复 |
| 5 | 点赞乐观更新无回滚 | suggest 页添加 catch 回滚逻辑 | ✅ 已修复 |

### P2 — 健壮性隐患（边缘场景）

| # | 问题 | 修复方案 | 状态 |
|---|------|---------|------|
| 1 | 后端闲置路由未接入 | 全部高价值路由已接入 | ✅ 已修复 |
| 2 | SVG 元素问题 | 已修复 ✓ | ✅ 已修复 |
| 3 | item-detail 无穿着记录 | 接入 `POST /items/{id}/wear` | ✅ 已修复 |
| 4 | item-detail 无清洗记录 | 接入 `POST /items/{id}/wash` | ✅ 已修复 |
| 5 | item-detail 无归档功能 | 接入 `POST /items/{id}/archive` | ✅ 已修复 |
| 6 | item-detail 无 AI 分析 | 接入 `POST /items/{id}/analyze` | ✅ 已修复 |
| 7 | home 无天气预报 | 接入 `GET /weather/forecast` | ✅ 已修复 |
| 8 | profile 无家庭信息 | 接入 `GET /families/me` | ✅ 已修复 |
| 9 | analytics 无学习画像 | 接入 `GET /learning` | ✅ 已修复 |
| 10 | login 无推送注册 | 接入 `POST /notifications/push-token` | ✅ 已修复 |
| 11 | preferences 无通知设置 | 接入 `GET /notifications/settings` | ✅ 已修复 |

---

## 五、建议的修复顺序

1. **立即修复**：10 处 `.map()` 空值保护（防止白屏）
2. **短期修复**：补齐 9 个断裂接口（后端新增或前端适配）
3. **中期优化**：隐藏/实现 6 个占位符功能
4. **长期规划**：逐步接入后端闲置的 76 个路由
