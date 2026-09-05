#!/usr/bin/env python3
"""
Backfill galaxy coordinates for each race's start system via EDSM.

Resolves the `system` name of every location that has no coordinates yet and
stores the galactic X/Y/Z on the `locations` row. Systems are looked up once
each (deduplicated) and applied to every race sharing that system.

Usage:
    .venv/bin/python3 scripts/backfill_system_coords.py [--force] [--limit N]

Options:
    --force   Re-resolve systems that already have coordinates.
    --limit N Only process the first N unresolved systems (for testing).
"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# ruff: noqa: E402
import httpx

from app.database import get_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
log = logging.getLogger(__name__)

EDSM_URL = "https://www.edsm.net/api-v1/system"
REQUEST_DELAY = 0.4  # polite pacing between EDSM lookups (seconds)


async def resolve_system(client: httpx.AsyncClient, name: str) -> dict | None:
    """Return {'x','y','z'} for a system name, or None if not found."""
    try:
        resp = await client.get(
            EDSM_URL,
            params={"systemName": name, "showCoordinates": "1"},
        )
    except httpx.RequestError as exc:
        log.warning("EDSM request failed for %r: %s", name, exc)
        return None
    if resp.status_code != 200:
        log.warning("EDSM returned %s for %r", resp.status_code, name)
        return None
    data = resp.json()
    if not data or "coords" not in data:
        return None
    return data["coords"]


async def main(force: bool, limit: int | None) -> None:
    db = await get_db()
    try:
        cond = "system != ''" if force else "sys_x IS NULL AND system != ''"
        async with db.execute(
            f"SELECT DISTINCT system FROM locations WHERE {cond} ORDER BY system"
        ) as cur:
            systems = [row["system"] async for row in cur]

        if limit is not None:
            systems = systems[:limit]

        log.info("Resolving %d system(s) via EDSM…", len(systems))

        resolved = 0
        missing = 0
        async with httpx.AsyncClient(timeout=10.0) as client:
            for name in systems:
                coords = await resolve_system(client, name)
                if coords is None:
                    missing += 1
                    log.warning("No coordinates found for %r", name)
                    await asyncio.sleep(REQUEST_DELAY)
                    continue
                now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                await db.execute(
                    """
                    UPDATE locations
                    SET sys_x = ?, sys_y = ?, sys_z = ?, coords_updated = ?
                    WHERE system = ?
                    """,
                    (coords["x"], coords["y"], coords["z"], now, name),
                )
                await db.commit()
                resolved += 1
                log.info("%s → (%s, %s, %s)", name, coords["x"], coords["y"], coords["z"])
                await asyncio.sleep(REQUEST_DELAY)

        log.info("Done. Resolved %d, missing %d.", resolved, missing)
    finally:
        await db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill race galaxy coordinates via EDSM.")
    parser.add_argument(
        "--force", action="store_true", help="Re-resolve already-populated systems."
    )
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N systems.")
    args = parser.parse_args()
    asyncio.run(main(force=args.force, limit=args.limit))
