"""
和风天气 (QWeather) API 适配器。
文档: https://dev.qweather.com/docs/api/
新版 API v7 使用 HTTPS，请求头带 key。
"""
import logging
from datetime import UTC, datetime

import httpx

from app.config import get_settings
from app.services.weather_service import WeatherData, WeatherServiceError

logger = logging.getLogger(__name__)

# 和风天气天气图标代码 → 我们的 condition 映射
# 参考: https://dev.qweather.com/docs/api/icons/
# 注意：和风天气 icon 代码和天气代码不同，icon 是三位数
QWEATHER_CODES = {
    # 晴
    "100": "sunny", "150": "sunny",
    # 多云
    "101": "partly cloudy", "102": "partly cloudy", "103": "partly cloudy",
    "151": "partly cloudy", "152": "partly cloudy", "153": "partly cloudy",
    # 阴
    "104": "cloudy", "154": "cloudy",
    # 晴转多云等过渡天气
    "300": "light rain", "301": "light rain",
    "302": "rain", "303": "heavy rain", "304": "heavy rain",
    "305": "light rain", "306": "rain", "307": "heavy rain",
    "308": "heavy rain", "309": "light drizzle",
    "310": "light rain", "311": "rain", "312": "heavy rain",
    "313": "heavy rain", "314": "light rain", "315": "rain",
    "316": "heavy rain", "317": "heavy rain", "318": "heavy rain",
    "399": "rain",
    "350": "light rain", "351": "light rain",
    # 雪
    "400": "light snow", "401": "snow", "402": "heavy snow",
    "403": "heavy snow", "404": "snow", "405": "snow",
    "406": "light snow", "407": "light snow", "408": "snow",
    "409": "heavy snow", "410": "heavy snow",
    "456": "light snow", "457": "light snow", "499": "snow",
    # 雾/霾
    "500": "foggy", "501": "foggy", "502": "foggy",
    "503": "foggy", "504": "foggy", "507": "foggy",
    "508": "foggy", "509": "foggy", "510": "foggy",
    "511": "foggy", "512": "foggy", "513": "foggy",
    "514": "foggy", "515": "foggy",
    # 极端天气
    "900": "sunny",  # hot
    "901": "snow",   # cold
    "999": "unknown",
}

# Chinese weather text → English condition (fallback when code mapping fails)
CN_WEATHER_TEXT_MAP = {
    "晴": "sunny",
    "多云": "partly cloudy",
    "阴": "cloudy",
    "阵雨": "light rain",
    "雷阵雨": "thunderstorm",
    "小雨": "light rain",
    "中雨": "rain",
    "大雨": "heavy rain",
    "暴雨": "heavy rain",
    "大暴雨": "heavy rain",
    "特大暴雨": "heavy rain",
    "毛毛雨": "light drizzle",
    "小雪": "light snow",
    "中雪": "snow",
    "大雪": "heavy snow",
    "暴雪": "heavy snow",
    "雨夹雪": "sleet",
    "雾": "foggy",
    "霾": "foggy",
    "沙尘暴": "foggy",
    "浮尘": "foggy",
    "扬沙": "foggy",
}


class QWeatherService:
    """和风天气 API v7 适配器。"""

    def __init__(self):
        settings = get_settings()
        self.host = settings.qweather_api_host
        self.api_key = settings.qweather_api_key

    def is_configured(self) -> bool:
        """Check if QWeather is configured with API key and host."""
        return bool(self.host and self.api_key)

    def _build_url(self, endpoint: str) -> str:
        return f"https://{self.host}{endpoint}"

    def _get_headers(self) -> dict:
        return {"Accept": "application/json"}

    def _get_params(self, extra: dict | None = None) -> dict:
        params = {"key": self.api_key}
        if extra:
            params.update(extra)
        return params

    def _interpret_code(self, code: str) -> str:
        return QWEATHER_CODES.get(code, "unknown")

    async def get_current_weather(self, latitude: float, longitude: float) -> WeatherData:
        """
        获取实时天气。
        和风天气 API location 格式: 经度,纬度 (注意顺序！)
        """
        location = f"{longitude:.2f},{latitude:.2f}"

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            try:
                # 获取实时天气
                now_resp = await client.get(
                    self._build_url("/v7/weather/now"),
                    params=self._get_params({"location": location}),
                    headers=self._get_headers(),
                )
                now_resp.raise_for_status()
                now_data = now_resp.json()

                if now_data.get("code") != "200":
                    raise WeatherServiceError(
                        f"QWeather API error: code={now_data.get('code')}, "
                        f"location={location}"
                    )

                now = now_data.get("now", {})

                # 获取未来1小时降水概率（用3天预报替代）
                forecast_resp = await client.get(
                    self._build_url("/v7/weather/3d"),
                    params=self._get_params({"location": location}),
                    headers=self._get_headers(),
                )
                forecast_resp.raise_for_status()
                forecast_data = forecast_resp.json()

                precip_chance = 0
                if forecast_data.get("code") == "200":
                    daily = forecast_data.get("daily", [])
                    if daily:
                        # 今天的数据
                        today = daily[0]
                        precip_chance = int(today.get("precip", "0").split("%")[0]) if "%" in str(today.get("precip", "0")) else 0

                # 和风天气 icon 字段是天气代码，text 字段是中文天气描述
                weather_icon = now.get("icon", "999")
                weather_text = now.get("text", "")

                # 直接使用中文天气描述（和风天气 API 已返回中文）
                condition = self._interpret_code(weather_icon)
                if condition == "unknown" and weather_text:
                    # Map Chinese text to English condition for the recommendation pipeline
                    condition = CN_WEATHER_TEXT_MAP.get(weather_text, weather_text)

                weather = WeatherData(
                    temperature=float(now.get("temp", 0)),
                    feels_like=float(now.get("feelsLike", 0)),
                    humidity=int(now.get("humidity", 0)),
                    precipitation_chance=precip_chance,
                    precipitation_mm=float(now.get("precip", 0)),
                    wind_speed=float(now.get("windSpeed", 0)),
                    condition=condition,
                    condition_code=int(weather_icon) if weather_icon.isdigit() else 999,
                    is_day=now.get("text", "").find("夜") == -1,
                    uv_index=float(now.get("uvIndex", 0)),
                    city=await self.reverse_geocode(latitude, longitude),
                    timestamp=datetime.now(UTC),
                )

                logger.info(
                    f"QWeather fetched for ({latitude}, {longitude}): "
                    f"{weather.temperature}°C, {weather.condition}"
                )

                return weather

            except httpx.HTTPError as e:
                logger.error(f"QWeather API HTTP error: {e}")
                raise WeatherServiceError(f"Failed to fetch QWeather: {e}") from None

    async def reverse_geocode(self, latitude: float, longitude: float) -> str:
        location = f"{longitude:.2f},{latitude:.2f}"
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            try:
                resp = await client.get(
                    self._build_url("/geo/v2/city/lookup"),
                    params=self._get_params({"location": location}),
                    headers=self._get_headers(),
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == "200":
                    locs = data.get("location", [])
                    if locs:
                        loc = locs[0]
                        parts = []
                        if loc.get("adm2"):
                            parts.append(loc["adm2"])
                        if loc.get("adm1"):
                            parts.append(loc["adm1"])
                        return " ".join(parts) or loc.get("name", "")
                logger.warning("QWeather GeoAPI returned code=%s", data.get("code"))
            except Exception as e:
                logger.warning("QWeather reverse_geocode failed: %s", e)
        return ""

    async def get_daily_forecast(self, latitude: float, longitude: float, days: int = 3) -> list[dict]:
        """
        获取未来几天天气预报。
        返回格式: [{"date": "2025-05-26", "temp_min": 18, "temp_max": 28, "condition": "sunny", "precipitation_chance": 20}, ...]
        """
        location = f"{longitude:.2f},{latitude:.2f}"

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            try:
                resp = await client.get(
                    self._build_url("/v7/weather/3d"),
                    params=self._get_params({"location": location}),
                    headers=self._get_headers(),
                )
                resp.raise_for_status()
                data = resp.json()

                if data.get("code") != "200":
                    raise WeatherServiceError(f"QWeather forecast error: code={data.get('code')}")

                forecasts = []
                for day in data.get("daily", [])[:days]:
                    icon_day = day.get("iconDay", "999")
                    text_day = day.get("textDay", "")
                    precip_str = day.get("precip", "0")
                    precip_pct = int(precip_str.split("%")[0]) if "%" in str(precip_str) else 0

                    day_condition = self._interpret_code(icon_day)
                    if day_condition == "unknown" and text_day:
                        day_condition = text_day

                    forecasts.append({
                        "date": day.get("fxDate", ""),
                        "temp_min": float(day.get("tempMin", 0)),
                        "temp_max": float(day.get("tempMax", 0)),
                        "condition": day_condition,
                        "condition_code": int(icon_day) if icon_day.isdigit() else 999,
                        "precipitation_chance": precip_pct,
                    })

                return forecasts

            except httpx.HTTPError as e:
                logger.error(f"QWeather forecast HTTP error: {e}")
                raise WeatherServiceError(f"Failed to fetch QWeather forecast: {e}") from None
