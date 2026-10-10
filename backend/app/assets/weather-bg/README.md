# 天气背景图（本地素材）

首页天气卡片的背景图由后端路由 `GET /api/v1/weather/backgrounds/{filename}` 提供，
替代已停服的 OSS bucket（原图当年直传 OSS，本地无副本）。

放置以下 6 个文件即可恢复插图背景（缺失时小程序回退为渐变背景，不影响使用）：

- `sunny.png`（晴）
- `cloudy.png`（多云）
- `rainy.png`（雨）
- `snowy.png`（雪）
- `foggy.png`（雾）
- `thunderstorm.png`（雷暴）

素材恢复途径：OSS 续费后从 bucket 的 `weather-bg/` 目录下载，或重新制作同名的任意
风格插图（建议宽度 750px 左右）。

注意：文件随镜像一起构建（`COPY . .`）。新增/替换文件后需
`docker compose up -d --build backend worker` 才会在容器内生效。
