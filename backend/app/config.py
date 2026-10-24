import logging
from functools import lru_cache

from pydantic import Field, PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

DEFAULT_SECRET_KEY = "change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "Wardrowbe"
    debug: bool = False
    secret_key: str = Field(default=DEFAULT_SECRET_KEY)
    studio_disabled: bool = False

    # CORS
    cors_origins: list[str] = Field(default=["http://localhost:3000", "http://localhost:8081"])

    # Database
    database_url: PostgresDsn = Field(
        default="postgresql+asyncpg://wardrobe:wardrobe@localhost:5432/wardrobe"
    )
    database_echo: bool = False

    # Redis
    redis_url: RedisDsn = Field(default="redis://localhost:6379/0")

    # Authentication - OIDC
    oidc_issuer_url: str | None = Field(default=None)
    oidc_client_id: str | None = Field(default=None)
    oidc_client_secret: str | None = None
    oidc_mobile_client_id: str | None = None

    # Authentication - WeChat Mini Program
    wechat_appid: str | None = Field(default=None)
    wechat_secret: str | None = Field(default=None)

    # AI Service (OpenAI-compatible API - supports Ollama, OpenAI, etc.)
    ai_base_url: str = Field(default="")
    ai_api_key: str | None = Field(default=None)
    ai_vision_model: str = Field(default="gpt-4o")  # comma-separated for model rotation
    ai_text_model: str = Field(default="gpt-4o")  # comma-separated for model rotation
    ai_timeout: int = Field(default=180)
    ai_max_retries: int = Field(default=3)
    ai_max_tokens: int = Field(default=8000)

    # Weather - Open-Meteo (fallback)
    openmeteo_url: str = Field(default="https://api.open-meteo.com/v1")
    openmeteo_fallback_url: str | None = Field(default=None)

    # Weather - QWeather / 和风天气 (primary for China)
    qweather_api_host: str | None = Field(default=None)
    qweather_api_key: str | None = Field(default=None)

    # Notifications - default ntfy channel (used when user has none configured)
    ntfy_server: str | None = None
    ntfy_topic: str | None = None
    ntfy_token: str | None = None
    # Legacy/other providers
    mattermost_webhook_url: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    # Storage
    storage_path: str = Field(default="/data/wardrobe")
    max_upload_size_mb: int = Field(default=10)

    # Alibaba Cloud DashScope - Virtual Try-On (OutfitAnyone)
    dashscope_api_key: str | None = Field(default=None)
    dashscope_tryon_model: str = Field(default="qwen-image-3.0")  # aitryon retired 2026-10-10
    dashscope_refine_model: str = Field(default="aitryon-refiner")
    dashscope_parse_model: str = Field(default="aitryon-parsing-v1")
    dashscope_base_url: str = Field(default="https://dashscope.aliyuncs.com/api/v1")
    virtual_tryon_timeout: int = Field(default=300)  # generation call timeout (qwen ~80-100s)

    # Alibaba Cloud Vision Intelligence - Image Preprocessing
    aliyun_access_key_id: str | None = Field(default=None)
    aliyun_access_key_secret: str | None = Field(default=None)
    aliyun_vision_endpoint: str = Field(default="imageseg.cn-shanghai.aliyuncs.com")

    # Alibaba Cloud OSS - Image Storage
    aliyun_oss_bucket: str | None = Field(default=None)
    aliyun_oss_endpoint: str | None = Field(default=None)
    aliyun_oss_region: str | None = Field(default=None)
    aliyun_oss_public_url: str | None = Field(
        default=None
    )  # e.g. https://bucket.oss-cn-chengdu.aliyuncs.com

    # Taobao Union API
    taobao_app_key: str | None = Field(default=None)
    taobao_app_secret: str | None = Field(default=None)
    taobao_adzone_id: str | None = Field(default=None)
    taobao_material_id: int = Field(default=17004)

    # Background removal
    bg_removal_provider: str = Field(default="rembg")  # "rembg" or "http"
    bg_removal_model: str = Field(default="u2net")  # rembg model name
    bg_removal_url: str | None = Field(default=None)  # URL for http provider (e.g. withoutbg)
    bg_removal_api_key: str | None = Field(default=None)  # API key for http provider

    # Image processing
    thumbnail_size: int = 400
    medium_size: int = 800
    original_max_size: int = 2400
    image_quality: int = 90

    # Suggest-feed prewarm pool (ready-to-view outfits with try-on images)
    suggest_pool_target: int = 4  # keep this many ready outfits in the pool
    suggest_feed_page: int = 2  # outfits served per feed call
    suggest_daily_batch_budget: int = 2  # replenish runs per user per day (cost cap)
    suggest_library_since: str = "2026-10-01"  # oldest try-on image served from the library

    def validate_security(self) -> str | None:
        if self.secret_key == DEFAULT_SECRET_KEY and not self.debug:
            raise RuntimeError(
                "SECRET_KEY is still the default value. "
                "Set a secure SECRET_KEY or enable DEBUG mode for development."
            )

        oidc_issuer = bool(self.oidc_issuer_url)
        oidc_client = bool(self.oidc_client_id)
        if oidc_issuer != oidc_client:
            raise RuntimeError(
                "OIDC is partially configured: both OIDC_ISSUER_URL and OIDC_CLIENT_ID must be set together."
            )

        oidc_configured = oidc_issuer and oidc_client
        wechat_configured = bool(self.wechat_appid and self.wechat_secret)
        is_dev = self.debug and self.secret_key == DEFAULT_SECRET_KEY
        if not oidc_configured and not wechat_configured and not is_dev:
            return (
                "No authentication method configured. "
                "Set OIDC_ISSUER_URL + OIDC_CLIENT_ID, WECHAT_APPID + WECHAT_SECRET, or enable DEBUG mode."
            )

        return None

    def get_auth_mode(self) -> str:
        if self.debug and self.secret_key == DEFAULT_SECRET_KEY:
            return "dev"
        if self.oidc_issuer_url and self.oidc_client_id:
            return "oidc"
        if self.wechat_appid and self.wechat_secret:
            return "wechat"
        return "unknown"


@lru_cache
def get_settings() -> Settings:
    return Settings()
