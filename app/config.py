"""Central configuration — reads environment variables once at import time."""

import os

OFFLINE: bool = os.environ.get("OFFLINE", "").strip().lower() in ("1", "true", "yes")

# Inara API configuration
INARA_API_KEY: str = os.environ.get("INARA_API_KEY", "")
INARA_APP_NAME: str = os.environ.get("INARA_APP_NAME", "elitettleaderboard.vladigor.net")
INARA_APP_VERSION: str = os.environ.get("INARA_APP_VERSION", "1.0")
INARA_CACHE_DURATION_DAYS: int = int(os.environ.get("INARA_CACHE_DURATION_DAYS", "7"))
