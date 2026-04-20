"""Central configuration — reads environment variables once at import time."""

import os

OFFLINE: bool = os.environ.get("OFFLINE", "").strip().lower() in ("1", "true", "yes")
