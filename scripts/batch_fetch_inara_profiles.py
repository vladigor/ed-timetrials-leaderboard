#!/usr/bin/env python3
"""
Batch fetch Inara profiles for the most recently active commanders.

Usage:
    python3 scripts/batch_fetch_inara_profiles.py [--limit N]

Examples:
    python3 scripts/batch_fetch_inara_profiles.py --limit 50
    python3 scripts/batch_fetch_inara_profiles.py --limit 100
"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add parent directory to path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env file before importing config
from dotenv import load_dotenv

load_dotenv()

# ruff: noqa: E402
import httpx

from app.config import INARA_API_KEY, INARA_APP_NAME, INARA_APP_VERSION, OFFLINE
from app.database import get_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
log = logging.getLogger(__name__)

INARA_API_URL = "https://inara.cz/inapi/v1/"


async def get_recent_commanders(limit: int = 50) -> list[str]:
    """Get the N most recently active commanders from the database."""
    db = await get_db()
    try:
        query = """
            SELECT DISTINCT name
            FROM results
            ORDER BY updated DESC
            LIMIT ?
        """
        async with db.execute(query, (limit,)) as cur:
            rows = await cur.fetchall()
        commanders = [row[0] for row in rows]
        log.info("Found %d recent commanders", len(commanders))
        return commanders
    finally:
        await db.close()


async def batch_fetch_profiles(commanders: list[str]) -> dict[str, dict]:
    """
    Fetch multiple commander profiles from Inara in a single API call.

    Returns a dict mapping commander name to profile data:
    {
        "CommanderName": {
            "avatar_url": "https://...",
            "inara_url": "https://...",
            "status": 200  # or other status code
        }
    }
    """
    if not INARA_API_KEY:
        log.error("INARA_API_KEY not set - cannot fetch profiles")
        return {}

    if OFFLINE:
        log.warning("OFFLINE mode - skipping API call")
        return {}

    # Build batched request
    events = []
    for cmdr in commanders:
        events.append(
            {
                "eventName": "getCommanderProfile",
                "eventTimestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "eventData": {"searchName": cmdr},
            }
        )

    payload = {
        "header": {
            "appName": INARA_APP_NAME,
            "appVersion": INARA_APP_VERSION,
            "APIkey": INARA_API_KEY,
        },
        "events": events,
    }

    log.info("Sending batch request for %d commanders...", len(commanders))

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(INARA_API_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        log.error("Inara API request failed: %s", exc)
        return {}

    if not data or "events" not in data:
        log.error("Inara API returned invalid response")
        return {}

    # Process responses
    results = {}
    for i, event in enumerate(data["events"]):
        cmdr_name = commanders[i]
        status = event.get("eventStatus")

        if status == 200:
            event_data = event.get("eventData", {})
            avatar_url = event_data.get("avatarImageURL", "")
            inara_url = event_data.get("inaraURL", "")

            if avatar_url and inara_url:
                results[cmdr_name] = {
                    "avatar_url": avatar_url,
                    "inara_url": inara_url,
                    "status": status,
                }
                log.info("✓ %s: Found profile", cmdr_name)
            else:
                log.warning("✗ %s: Profile missing avatar or URL", cmdr_name)
                results[cmdr_name] = {"status": status, "error": "missing_data"}
        else:
            log.warning("✗ %s: Status %s", cmdr_name, status)
            results[cmdr_name] = {"status": status}

    return results


async def cache_profiles(profiles: dict[str, dict]) -> int:
    """
    Store profiles in the inara_cache table.

    Returns the number of profiles successfully cached.
    """
    db = await get_db()
    cached_count = 0

    try:
        for cmdr_name, profile in profiles.items():
            if profile.get("status") != 200 or "avatar_url" not in profile:
                continue

            await db.execute(
                """
                INSERT INTO inara_cache (commander_name, avatar_url, inara_url, cached_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(commander_name) DO UPDATE SET
                    avatar_url = excluded.avatar_url,
                    inara_url = excluded.inara_url,
                    cached_at = excluded.cached_at
                """,
                (
                    cmdr_name,
                    profile["avatar_url"],
                    profile["inara_url"],
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            cached_count += 1

        await db.commit()
        log.info("Cached %d profiles successfully", cached_count)
        return cached_count
    finally:
        await db.close()


async def show_cache_stats():
    """Display current cache statistics."""
    db = await get_db()
    try:
        async with db.execute("SELECT COUNT(*) FROM inara_cache") as cur:
            row = await cur.fetchone()
            total = row[0]

        # Count expired entries (older than 7 days)
        async with db.execute(
            """
            SELECT COUNT(*) FROM inara_cache
            WHERE datetime(cached_at) < datetime('now', '-7 days')
            """
        ) as cur:
            row = await cur.fetchone()
            expired = row[0]

        log.info("Cache statistics:")
        log.info("  Total profiles: %d", total)
        log.info("  Expired (>7 days): %d", expired)
        log.info("  Fresh: %d", total - expired)
    finally:
        await db.close()


async def main():
    parser = argparse.ArgumentParser(description="Batch fetch Inara profiles for recent commanders")
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Number of recent commanders to fetch (default: 50)",
    )
    parser.add_argument(
        "--stats-only",
        action="store_true",
        help="Only show cache statistics, don't fetch",
    )
    args = parser.parse_args()

    if args.stats_only:
        await show_cache_stats()
        return

    log.info("=" * 60)
    log.info("Batch Inara Profile Fetcher")
    log.info("=" * 60)

    # Step 1: Get recent commanders
    commanders = await get_recent_commanders(limit=args.limit)
    if not commanders:
        log.error("No commanders found in database")
        return

    # Step 2: Batch fetch from Inara API
    profiles = await batch_fetch_profiles(commanders)

    success_count = sum(1 for p in profiles.values() if p.get("status") == 200)
    log.info("\nFetch summary:")
    log.info("  Requested: %d", len(commanders))
    log.info("  Success: %d", success_count)
    log.info("  Failed: %d", len(commanders) - success_count)

    # Step 3: Cache the results
    if profiles:
        log.info("\nCaching profiles...")
        cached = await cache_profiles(profiles)
        log.info("Cached %d profiles", cached)

    # Step 4: Show final stats
    log.info("")
    await show_cache_stats()


if __name__ == "__main__":
    asyncio.run(main())
