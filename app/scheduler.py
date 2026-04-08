"""Background scheduler that polls the API for changes."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .config import OFFLINE
from .database import get_db
from .importer import (
    fetch_and_store_locations,
    fetch_and_store_results,
    fetch_and_store_race_details,
    fetch_last_updated,
)

log = logging.getLogger(__name__)

# In-memory snapshot of the last-updated map returned by the API.
# Updated after every poll so the /api/poll endpoint can return it inexpensively.
_last_updated_snapshot: dict[str, datetime] = {}

POLL_INTERVAL_SECONDS = 60


# ---------------------------------------------------------------------------
# Cache persistence helpers
# ---------------------------------------------------------------------------

async def _load_cache() -> dict[str, str]:
    """Load the persisted last-updated timestamps from the database (as ISO strings)."""
    db = await get_db()
    try:
        async with db.execute("SELECT key, updated FROM last_updated_cache") as cursor:
            rows = await cursor.fetchall()
        return {row["key"]: row["updated"] for row in rows}
    finally:
        await db.close()


async def _save_cache(snapshot: dict[str, datetime]) -> None:
    """Persist last-updated timestamps so restarts don't re-fetch unchanged data."""
    db = await get_db()
    try:
        for key, when in snapshot.items():
            await db.execute(
                """
                INSERT INTO last_updated_cache (key, updated)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET updated = excluded.updated
                """,
                (key, when.isoformat()),
            )
        await db.commit()
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Scheduler jobs
# ---------------------------------------------------------------------------

async def _backfill_missing_results() -> None:
    """Fetch results for races that exist in locations but have no results."""
    db = await get_db()
    try:
        async with db.execute(
            """
            SELECT l.key
            FROM locations l
            WHERE NOT EXISTS (
                SELECT 1 FROM results WHERE location = l.key
            )
            """
        ) as cursor:
            rows = await cursor.fetchall()
        keys = [row["key"] for row in rows]
    finally:
        await db.close()

    if keys:
        log.info("Backfilling results for %d races with no results: %s", len(keys), keys)
        for key in keys:
            try:
                await fetch_and_store_results(key)
            except Exception as exc:
                log.error("Failed to backfill results for %s: %s", key, exc)


async def _sync_changed(old: dict[str, datetime], new: dict[str, datetime]) -> None:
    """Fetch results for every key whose timestamp has changed or is new."""
    for key, when in new.items():
        if old.get(key) != when:
            log.info("Results changed for %s (was %s, now %s)", key, old.get(key), when)
            try:
                await fetch_and_store_results(key)
            except Exception as exc:
                log.error("Failed to fetch results for %s: %s", key, exc)


async def poll() -> None:
    """One polling cycle: refresh locations, check last-updated, fetch changed results, persist cache."""
    global _last_updated_snapshot
    
    # Refresh the locations list to detect new races
    try:
        await fetch_and_store_locations()
    except Exception as exc:
        log.error("Failed to fetch locations during poll: %s", exc)
    
    # Fetch details for any new races
    try:
        await fetch_and_store_race_details()
    except Exception as exc:
        log.error("Failed to fetch race details during poll: %s", exc)
    
    try:
        fresh = await fetch_last_updated()
    except Exception as exc:
        log.error("Failed to fetch last-updated: %s", exc)
        return

    # Backfill: fetch results for any races that are in locations but have zero results.
    # This handles cases where races were added while the location list wasn't being
    # refreshed, causing foreign key constraint failures on result inserts.
    await _backfill_missing_results()

    await _sync_changed(_last_updated_snapshot, fresh)
    await _save_cache(fresh)
    _last_updated_snapshot = fresh


async def full_refresh() -> None:
    """
    On startup: refresh the location list, then fetch results only for TTs whose
    last-updated timestamp has changed since the previous run (stored in the DB).
    """
    log.info("Running startup refresh…")
    try:
        await fetch_and_store_locations()
    except Exception as exc:
        log.error("Failed to fetch locations: %s", exc)
        return

    try:
        await fetch_and_store_race_details()
    except Exception as exc:
        log.error("Failed to fetch race details: %s", exc)

    global _last_updated_snapshot
    try:
        fresh = await fetch_last_updated()
    except Exception as exc:
        log.error("Failed to fetch last-updated during startup: %s", exc)
        return

    # Compare against what we persisted last time
    stored = await _load_cache()

    changed = 0
    for key, when in fresh.items():
        if stored.get(key) != when.isoformat():
            try:
                await fetch_and_store_results(key)
                changed += 1
            except Exception as exc:
                log.error("Failed to fetch results for %s: %s", key, exc)

    await _save_cache(fresh)
    _last_updated_snapshot = fresh
    log.info(
        "Startup refresh complete. %d TTs tracked, %d updated.",
        len(fresh), changed,
    )


def get_last_updated_snapshot() -> dict[str, str]:
    """Return the current snapshot as ISO strings (safe to serialise to JSON)."""
    return {k: v.isoformat() for k, v in _last_updated_snapshot.items()}


def start_scheduler() -> AsyncIOScheduler:
    if OFFLINE:
        log.warning("OFFLINE MODE — scheduler not started.")
        return None
    scheduler = AsyncIOScheduler()
    scheduler.add_job(poll, "interval", seconds=POLL_INTERVAL_SECONDS, id="poll_loop")
    scheduler.start()
    return scheduler
