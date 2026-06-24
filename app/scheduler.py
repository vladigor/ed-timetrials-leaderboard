"""Background scheduler that polls the API for changes."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .config import OFFLINE
from .database import get_db
from .importer import (
    fetch_and_store_daynight_bulk,
    fetch_and_store_locations,
    fetch_and_store_race_details,
    fetch_and_store_results,
    fetch_last_updated,
)

log = logging.getLogger(__name__)

# In-memory snapshot of the last-updated map returned by the API.
# Updated after every poll so the /api/poll endpoint can return it inexpensively.
_last_updated_snapshot: dict[str, datetime] = {}

# In-memory diagnostics for poll loop health.
_poll_runs = 0
_poll_successes = 0
_poll_errors = 0
_last_poll_started_at: datetime | None = None
_last_poll_finished_at: datetime | None = None
_last_poll_success_at: datetime | None = None
_last_poll_error: str | None = None
_scheduler_started_at: datetime | None = None

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


async def _refresh_daynight_bulk() -> None:
    """Fetch and store bulk day/night data.  Called daily at 05:00 UTC."""
    try:
        count = await fetch_and_store_daynight_bulk()
        log.info("Day/night bulk refresh complete: %d races updated.", count)
    except Exception as exc:
        log.error("Day/night bulk refresh failed: %s", exc)


async def _maybe_refresh_daynight_bulk() -> None:
    """Refresh bulk day/night data on startup if missing or older than 23 hours."""
    db = await get_db()
    try:
        async with db.execute(
            "SELECT MAX(fetched_at) AS last_fetched FROM daynight_bulk_cache"
        ) as cursor:
            row = await cursor.fetchone()
        last_fetched = row["last_fetched"] if row else None
    finally:
        await db.close()

    if last_fetched:
        try:
            dt = datetime.fromisoformat(last_fetched.replace("Z", "+00:00"))
            age_hours = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
            if age_hours < 23:
                log.info("Day/night bulk data is %.1f h old — skipping startup refresh.", age_hours)
                return
        except ValueError:
            pass

    log.info("Day/night bulk data missing or stale — refreshing on startup…")
    await _refresh_daynight_bulk()


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
    global _poll_runs, _poll_successes, _poll_errors
    global _last_poll_started_at, _last_poll_finished_at, _last_poll_success_at, _last_poll_error

    _poll_runs += 1
    _last_poll_started_at = datetime.utcnow()
    cycle_errors: list[str] = []

    # Refresh the locations list to detect new races
    try:
        await fetch_and_store_locations()
    except Exception as exc:
        log.error("Failed to fetch locations during poll: %s", exc)
        cycle_errors.append(f"fetch_and_store_locations: {exc}")

    # Fetch details for any new races
    try:
        await fetch_and_store_race_details()
    except Exception as exc:
        log.error("Failed to fetch race details during poll: %s", exc)
        cycle_errors.append(f"fetch_and_store_race_details: {exc}")

    try:
        fresh = await fetch_last_updated()
    except Exception as exc:
        log.error("Failed to fetch last-updated: %s", exc)
        cycle_errors.append(f"fetch_last_updated: {exc}")
        _poll_errors += 1
        _last_poll_error = "; ".join(cycle_errors)
        _last_poll_finished_at = datetime.utcnow()
        return

    # Backfill: fetch results for any races that are in locations but have zero results.
    # This handles cases where races were added while the location list wasn't being
    # refreshed, causing foreign key constraint failures on result inserts.
    try:
        await _backfill_missing_results()
    except Exception as exc:
        log.error("Failed during backfill cycle: %s", exc)
        cycle_errors.append(f"_backfill_missing_results: {exc}")

    try:
        await _sync_changed(_last_updated_snapshot, fresh)
        await _save_cache(fresh)
        _last_updated_snapshot = fresh
    except Exception as exc:
        log.error("Failed to persist poll cycle: %s", exc)
        cycle_errors.append(f"persist_cycle: {exc}")

    if cycle_errors:
        _poll_errors += 1
        _last_poll_error = "; ".join(cycle_errors)
    else:
        _poll_successes += 1
        _last_poll_success_at = datetime.utcnow()

    _last_poll_finished_at = datetime.utcnow()


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
        len(fresh),
        changed,
    )

    # Refresh bulk day/night data if missing or stale (runs in background, non-blocking startup)
    try:
        await _maybe_refresh_daynight_bulk()
    except Exception as exc:
        log.error("Startup day/night bulk check failed: %s", exc)


def get_last_updated_snapshot() -> dict[str, str]:
    """Return the current snapshot as ISO strings (safe to serialise to JSON)."""
    return {k: v.isoformat() for k, v in _last_updated_snapshot.items()}


def get_poll_debug_status() -> dict[str, object]:
    """Return in-memory scheduler diagnostics for the poll loop."""
    return {
        "poll_interval_seconds": POLL_INTERVAL_SECONDS,
        "scheduler_started_at": _scheduler_started_at.isoformat()
        if _scheduler_started_at
        else None,
        "poll_runs": _poll_runs,
        "poll_successes": _poll_successes,
        "poll_errors": _poll_errors,
        "last_poll_started_at": _last_poll_started_at.isoformat()
        if _last_poll_started_at
        else None,
        "last_poll_finished_at": _last_poll_finished_at.isoformat()
        if _last_poll_finished_at
        else None,
        "last_poll_success_at": _last_poll_success_at.isoformat()
        if _last_poll_success_at
        else None,
        "last_poll_error": _last_poll_error,
        "snapshot_keys": len(_last_updated_snapshot),
    }


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler_started_at

    if OFFLINE:
        log.warning("OFFLINE MODE — scheduler not started.")
        return None
    scheduler = AsyncIOScheduler()
    # The host can occasionally run jobs 1-3 seconds late.
    # Without a grace window APScheduler marks these as misfires and skips the
    # poll cycle, which can make /api/poll appear stale until a restart.
    scheduler.add_job(
        poll,
        "interval",
        seconds=POLL_INTERVAL_SECONDS,
        id="poll_loop",
        misfire_grace_time=30,
        coalesce=True,
        max_instances=1,
    )
    scheduler.add_job(
        _refresh_daynight_bulk,
        "cron",
        hour=5,
        minute=0,
        id="daynight_bulk_refresh",
        misfire_grace_time=3600,
        coalesce=True,
        max_instances=1,
    )
    scheduler.start()
    _scheduler_started_at = datetime.utcnow()
    return scheduler
