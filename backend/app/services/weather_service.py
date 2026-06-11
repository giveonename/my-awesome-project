import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
import redis.asyncio as aioredis

from app.config import get_settings
from app.utils.redis_lock import get_redis

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class WeatherData:
    temperature: float  # Celsius
    feels_like: float  # Apparent temperature
    humidity: int  # Percentage
    precipitation_chance: int  # Percentage
    precipitation_mm: float  # mm in next hour
    wind_speed: float  # km/h
    condition: str  # sunny, cloudy, rainy, snowy, etc.
    condition_code: int  # WMO weather code
    is_day: bool
    uv_index: float
    timestamp: datetime
    city: str = "" 

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "temperature": self.temperature,
            "feels_like": self.feels_like,
            "humidity": self.humidity,
            "precipitation_chance": self.precipitation_chance,
            "precipitation_mm": self.precipitation_mm,
            "wind_speed": self.wind_speed,
            "condition": self.condition,
            "condition_code": self.condition_code,
            "is_day": self.is_day,
            "uv_index": self.uv_index,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class DailyForecast:
    """Daily weather forecast."""

    date: str  # YYYY-MM-DD
    temp_min: float
    temp_max: float
    precipitation_chance: int
    condition: str
    condition_code: int


# WMO Weather interpretation codes
# https://open-meteo.com/en/docs
WMO_CODES = {
    0: "sunny",
    1: "mostly sunny",
    2: "partly cloudy",
    3: "cloudy",
    45: "foggy",
    48: "foggy",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    56: "freezing drizzle",
    57: "freezing drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    66: "freezing rain",
    67: "freezing rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "light showers",
    81: "showers",
    82: "heavy showers",
    85: "light snow showers",
    86: "snow showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
    99: "thunderstorm with hail",
}


CACHE_TTL = 3600  # 1 hour
CACHE_PREFIX = "weather:"


class WeatherService:
    def __init__(self):
        self.base_url = settings.openmeteo_url
        self.fallback_url = settings.openmeteo_fallback_url

        # Lazy-load QWeather service (import here to avoid circular imports)
        self._qweather = None
        self._qweather_checked = False

    @staticmethod
    def _cache_key(lat: float, lon: float) -> str:
        return f"{CACHE_PREFIX}{round(lat, 2)},{round(lon, 2)}"

    async def _cache_get(self, lat: float, lon: float) -> WeatherData | None:
        try:
            redis = await get_redis()
            raw = await redis.get(self._cache_key(lat, lon))
        except aioredis.RedisError:
            logger.debug(f"Redis unavailable for weather cache read ({lat}, {lon})")
            return None
        if raw is None:
            return None
        data = json.loads(raw)
        data["timestamp"] = datetime.fromisoformat(data["timestamp"])
        logger.debug(f"Weather cache hit for ({lat}, {lon})")
        return WeatherData(**data)

    async def _cache_set(self, lat: float, lon: float, data: WeatherData) -> None:
        try:
            redis = await get_redis()
            await redis.set(
                self._cache_key(lat, lon),
                json.dumps(data.to_dict()),
                ex=CACHE_TTL,
            )
        except aioredis.RedisError:
            logger.debug(f"Redis unavailable for weather cache write ({lat}, {lon})")

    def _validate_coordinates(self, latitude: float, longitude: float) -> None:
        """Validate latitude and longitude bounds."""
        if not -90 <= latitude <= 90:
            raise ValueError(f"Invalid latitude {latitude}: must be between -90 and 90")
        if not -180 <= longitude <= 180:
            raise ValueError(f"Invalid longitude {longitude}: must be between -180 and 180")

    def _interpret_weather_code(self, code: int) -> str:
        """Convert WMO weather code to human-readable condition."""
        return WMO_CODES.get(code, "unknown")

    def _get_qweather(self):
        """Lazy-init QWeather service."""
        if not self._qweather_checked:
            self._qweather_checked = True
            try:
                from app.services.weather_cn import QWeatherService
                qws = QWeatherService()
                if qws.is_configured():
                    self._qweather = qws
                    logger.info("QWeather (和风天气) configured as primary weather provider")
                else:
                    logger.info("QWeather not configured, using Open-Meteo")
            except Exception as e:
                logger.warning(f"Failed to init QWeather: {e}")
        return self._qweather

    async def get_current_weather(
        self, latitude: float, longitude: float, use_cache: bool = True
    ) -> WeatherData:
        """
        Fetch current weather for a location.
        Priority: QWeather (和风天气) → Open-Meteo
        """
        self._validate_coordinates(latitude, longitude)

        if use_cache:
            cached = await self._cache_get(latitude, longitude)
            if cached:
                return cached

        # Try QWeather first (primary for China)
        qweather = self._get_qweather()
        if qweather:
            try:
                weather = await qweather.get_current_weather(latitude, longitude)
                await self._cache_set(latitude, longitude, weather)
                return weather
            except Exception as e:
                logger.warning(f"QWeather failed, falling back to Open-Meteo: {e}")

        # Fallback: Open-Meteo
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "current": [
                "temperature_2m",
                "apparent_temperature",
                "relative_humidity_2m",
                "precipitation",
                "weather_code",
                "wind_speed_10m",
                "is_day",
                "uv_index",
            ],
            "hourly": ["precipitation_probability"],
            "forecast_hours": 1,
            "timezone": "auto",
        }

        data = await self._fetch_with_fallback("/forecast", params)

        current = data.get("current", {})
        hourly = data.get("hourly", {})

        precip_probs = hourly.get("precipitation_probability", [])
        precip_chance = precip_probs[0] if precip_probs else 0

        weather_code = current.get("weather_code", 0)

        weather = WeatherData(
            temperature=current.get("temperature_2m", 0),
            feels_like=current.get("apparent_temperature", 0),
            humidity=current.get("relative_humidity_2m", 0),
            precipitation_chance=precip_chance,
            precipitation_mm=current.get("precipitation", 0),
            wind_speed=current.get("wind_speed_10m", 0),
            condition=self._interpret_weather_code(weather_code),
            condition_code=weather_code,
            is_day=bool(current.get("is_day", 1)),
            uv_index=current.get("uv_index", 0),
            timestamp=datetime.now(UTC),
        )

        await self._cache_set(latitude, longitude, weather)

        logger.info(
            f"Weather fetched for ({latitude}, {longitude}): "
            f"{weather.temperature}°C, {weather.condition}"
        )

        return weather

    async def get_daily_forecast(
        self, latitude: float, longitude: float, days: int = 7
    ) -> list[DailyForecast]:
        """
        Fetch daily forecast for a location.
        Priority: QWeather (和风天气) → Open-Meteo
        """
        self._validate_coordinates(latitude, longitude)

        # Try QWeather first
        qweather = self._get_qweather()
        if qweather:
            try:
                raw = await qweather.get_daily_forecast(latitude, longitude, min(days, 3))
                forecasts = []
                for item in raw:
                    forecasts.append(
                        DailyForecast(
                            date=item["date"],
                            temp_max=item["temp_max"],
                            temp_min=item["temp_min"],
                            precipitation_chance=item["precipitation_chance"],
                            condition=item["condition"],
                            condition_code=item["condition_code"],
                        )
                    )
                return forecasts
            except Exception as e:
                logger.warning(f"QWeather forecast failed, falling back to Open-Meteo: {e}")

        # Fallback: Open-Meteo
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "daily": [
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_probability_max",
                "weather_code",
            ],
            "forecast_days": min(days, 16),
            "timezone": "auto",
        }

        data = await self._fetch_with_fallback("/forecast", params)

        daily = data.get("daily", {})
        dates = daily.get("time", [])
        temp_maxs = daily.get("temperature_2m_max", [])
        temp_mins = daily.get("temperature_2m_min", [])
        precip_probs = daily.get("precipitation_probability_max", [])
        weather_codes = daily.get("weather_code", [])

        forecasts = []
        for i, date in enumerate(dates):
            code = weather_codes[i] if i < len(weather_codes) else 0
            forecasts.append(
                DailyForecast(
                    date=date,
                    temp_max=temp_maxs[i] if i < len(temp_maxs) else 0,
                    temp_min=temp_mins[i] if i < len(temp_mins) else 0,
                    precipitation_chance=precip_probs[i] if i < len(precip_probs) else 0,
                    condition=self._interpret_weather_code(code),
                    condition_code=code,
                )
            )

        return forecasts

    async def get_tomorrow_weather(self, latitude: float, longitude: float) -> WeatherData:
        """
        Fetch tomorrow's weather forecast and return as WeatherData.

        This is used for day-before notifications where we need to recommend
        outfits based on tomorrow's expected weather.

        Args:
            latitude: Location latitude
            longitude: Location longitude

        Returns:
            WeatherData with tomorrow's forecast (avg temp, conditions)
        """
        forecasts = await self.get_daily_forecast(latitude, longitude, days=2)

        if len(forecasts) < 2:
            # Fallback to current weather if forecast fails
            logger.warning("Could not get tomorrow's forecast, using current weather")
            return await self.get_current_weather(latitude, longitude)

        tomorrow = forecasts[1]  # Index 0 is today, 1 is tomorrow

        # Use average of min/max for the representative temperature
        avg_temp = (tomorrow.temp_min + tomorrow.temp_max) / 2
        # Use the max temp for feels_like (daytime outfit)
        feels_like = tomorrow.temp_max

        return WeatherData(
            temperature=round(avg_temp, 1),
            feels_like=round(feels_like, 1),
            humidity=50,  # Not available in daily forecast, use typical value
            precipitation_chance=tomorrow.precipitation_chance,
            precipitation_mm=0,  # Not available for forecast
            wind_speed=0,  # Not available in daily forecast
            condition=tomorrow.condition,
            condition_code=tomorrow.condition_code,
            is_day=True,  # Assume daytime for outfit recommendations
            uv_index=0,  # Not available in daily forecast
            timestamp=datetime.now(UTC),
        )

    async def _fetch_with_fallback(self, endpoint: str, params: dict) -> dict:
        """Fetch from primary URL, fall back to secondary if it fails.
        
        This helps in regions where the primary Open-Meteo URL may be blocked.
        """
        urls = [self.base_url]
        if self.fallback_url:
            urls.append(self.fallback_url)

        last_error = None
        for url in urls:
            try:
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                    response = await client.get(f"{url}{endpoint}", params=params)
                    response.raise_for_status()
                    return response.json()
            except httpx.HTTPError as e:
                logger.warning(f"Weather API error from {url}: {e}")
                last_error = e
                continue

        raise WeatherServiceError(f"Failed to fetch weather data: {last_error}") from last_error

    async def check_health(self) -> dict:
        """Check if the weather service is available."""
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                # Simple request to check API availability
                response = await client.get(
                    f"{self.base_url}/forecast",
                    params={"latitude": 0, "longitude": 0, "current": "temperature_2m"},
                )
                if response.status_code == 200:
                    return {"status": "healthy", "provider": "open-meteo"}
        except Exception as e:
            # Try fallback
            if self.fallback_url:
                try:
                    async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                        response = await client.get(
                            f"{self.fallback_url}/forecast",
                            params={"latitude": 0, "longitude": 0, "current": "temperature_2m"},
                        )
                        if response.status_code == 200:
                            return {"status": "healthy", "provider": "open-meteo-fallback"}
                except Exception:
                    pass
            return {"status": "unhealthy", "error": str(e)}

        return {"status": "unhealthy", "error": "Unknown error"}


class WeatherServiceError(Exception):
    pass

