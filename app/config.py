"""Central configuration — reads environment variables once at import time."""

import os

OFFLINE: bool = os.environ.get("OFFLINE", "").strip().lower() in ("1", "true", "yes")
ENV: str = os.environ.get("ENV", "prod").strip().lower()

# Inara API configuration
INARA_API_KEY: str = os.environ.get("INARA_API_KEY", "")
INARA_APP_NAME: str = os.environ.get("INARA_APP_NAME", "elitettleaderboard.vladigor.net")
INARA_APP_VERSION: str = os.environ.get("INARA_APP_VERSION", "1.0")
INARA_CACHE_DURATION_DAYS: int = int(os.environ.get("INARA_CACHE_DURATION_DAYS", "7"))

# Day/Night Calculator API
DAYLIGHT_API_ENABLED: bool = os.environ.get("DAYLIGHT_API_ENABLED", "true").strip().lower() in (
    "1",
    "true",
    "yes",
)
DAYLIGHT_API_BASE_URL: str = os.environ.get(
    "DAYLIGHT_API_BASE_URL", "https://eddaynight.de"
).rstrip("/")
DAYLIGHT_API_TIMEOUT: float = float(os.environ.get("DAYLIGHT_API_TIMEOUT", "15.0"))
DAYLIGHT_CACHE_TTL: int = int(os.environ.get("DAYLIGHT_CACHE_TTL", "300"))

# Favourites / Ignored feature flag
FAVOURITES_ENABLED: bool = os.environ.get("FAVOURITES_ENABLED", "").strip().lower() in (
    "1",
    "true",
    "yes",
)
# Comma-separated list of commanders who can access the daylight API even when DAYLIGHT_API_ENABLED=false
DAYLIGHT_API_ENABLED_FOR: frozenset[str] = frozenset(
    c.strip().lower()
    for c in os.environ.get("DAYLIGHT_API_ENABLED_FOR", "").split(",")
    if c.strip()
)
