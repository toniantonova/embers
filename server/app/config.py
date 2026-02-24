# ─────────────────────────────────────────────────────────────────────────────
# Settings — Pydantic v2 BaseSettings
# ─────────────────────────────────────────────────────────────────────────────


from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Server configuration sourced from environment variables.

    Uses pydantic-settings v2 (separate package from pydantic).
    """

    model_config = SettingsConfigDict(env_prefix="", env_file=".env")

    # ── Infrastructure ───────────────────────────────────────────────────────
    cache_bucket: str = "lumen-shape-cache-dev"
    model_cache_dir: str = "/home/appuser/models"
    model_weights_bucket: str = ""  # GCS bucket for HF weights; empty = disabled
    port: int = 8080

    # ── Security ─────────────────────────────────────────────────────────────
    # SecretStr prevents the key from leaking into logs, repr(), or
    # model_dump(). Access via settings.api_key.get_secret_value().
    # Empty string = auth disabled (local dev / test).
    api_key: SecretStr = SecretStr("")

    # Comma-separated origins for CORS (e.g. "https://app.example.com,http://localhost:5173").
    # Empty string = deny all cross-origin requests (secure default).
    allowed_origins: str = ""

    # Rate limit on /generate endpoint (slowapi format, e.g. "60/minute").
    rate_limit: str = "60/minute"

    # ── Feature flags ────────────────────────────────────────────────────────
    skip_model_load: bool = False  # True for testing without GPU
    enable_debug_routes: bool = False  # Set ENABLE_DEBUG_ROUTES=true for local dev

    # ── Limits ───────────────────────────────────────────────────────────────
    max_request_text_length: int = 200
    generation_timeout_seconds: int = 300
    max_points: int = 2048
    generation_rate_limit_per_minute: int = 20  # Tighter cap on GPU work (cache misses)
    vram_offload_threshold_gb: float = 80.0  # Offload fallback models if VRAM exceeds this (RTX Pro 6000: 96GB)
    eager_load_all: bool = False  # GCE: set EAGER_LOAD_ALL=true to preload fallback models

    # ── Logging ──────────────────────────────────────────────────────────────
    log_level: str = "INFO"
    log_json: bool = True  # JSON logs for Cloud Logging


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
