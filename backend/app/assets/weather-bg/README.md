# 天气背景图（本地素材）

首页天气卡片的背景图由后端路由 `GET /api/v1/weather/backgrounds/{filename}` 提供，
随镜像分发（`backend/app/assets/weather-bg/`），不再依赖 OSS。

六个文件名与天气状况对应：

- `sunny.png`（晴）
- `cloudy.png`（多云）
- `rainy.png`（雨）
- `snowy.png`（雪）
- `foggy.png`（雾）
- `thunderstorm.png`（雷暴）

替换或新增文件后，需 `docker compose up -d --build backend worker` 才会在容器内生效。
若文件缺失，小程序会自动回退为渐变背景，不影响使用。
