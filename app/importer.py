"""Fetch data from the Elite Dangerous Time Trials API and persist it."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
import aiosqlite

from .database import get_db

log = logging.getLogger(__name__)

BASE_URL = "https://razzserver.com/razapis"
TIME_FORMAT = "%Y-%m-%d %H:%M:%S.%f"

# ---------------------------------------------------------------------------
# Low-level HTTP helpers
# ---------------------------------------------------------------------------

async def _fetch(client: httpx.AsyncClient, url: str) -> Any:
    response = await client.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


# ---------------------------------------------------------------------------
# Parse helpers
# ---------------------------------------------------------------------------

def _normalise_version(raw: str) -> str:
    v = raw.upper()
    return "ODYSSEY" if v == "ODY" else v


def _parse_location(row: list[str]) -> dict:
    version = _normalise_version(row[7]) if len(row) > 7 else ""
    global_value = row[12] if len(row) > 12 and row[12] else "1"
    constraint_str = row[11] if len(row) > 11 else ""
    constraints = _parse_constraints(row[0], constraint_str, global_value)

    # Build a sort key: type + name
    sort = f"{row[5].upper() if len(row) > 5 else ''}_{row[1]}"

    return {
        "key": row[0],
        "name": row[1],
        "system": row[2] if len(row) > 2 else "",
        "station": row[3] if len(row) > 3 else "",
        "coords": row[4] if len(row) > 4 else "",
        "type": row[5].upper() if len(row) > 5 else "",
        "version": version,
        "address": row[8] if len(row) > 8 else "",
        "sort": sort,
        "constraints": constraints,
    }


# Vehicle type prefixes that appear before the `:` in each checkpoint's first field.
# Longer prefixes must come before shorter ones to avoid partial matches.
_VEHICLE_BASE_TYPES = [
    ("onfoot", "OnFoot"),
    ("fighter", "Fighter"),
    ("ship", "Ship"),
    ("srv", "SRV"),
]


def _base_vehicle(type_prefix: str) -> str | None:
    """Return the canonical base vehicle type from a checkpoint type prefix, or None."""
    low = type_prefix.lower()
    for prefix, canonical in _VEHICLE_BASE_TYPES:
        if low.startswith(prefix):
            return canonical
    return None


def _parse_ttdata(waypoints_str: str) -> tuple[int, bool, bool, bool]:
    """Parse the getTTData waypoints string.

    Returns (num_checkpoints, multi_planet, multi_system, multi_mode).
    Checkpoints are delimited by double-backticks (``).
    Each checkpoint's fields are ~-delimited: TYPE:System~[station]~body~coords~...
    multi_mode is True when the race requires more than one base vehicle type
    (e.g. Ship + SRV in a biathlon), detected from the type prefix of each checkpoint.
    """
    segments = [s for s in waypoints_str.split("``") if s.strip()]
    systems: set[str] = set()
    bodies: set[str] = set()
    vehicle_types: set[str] = set()

    for seg in segments:
        fields = seg.split("~")
        type_and_sys = fields[0]
        if ":" in type_and_sys:
            type_prefix, sys_name = type_and_sys.split(":", 1)
            sys_name = sys_name.strip()
            if sys_name:
                systems.add(sys_name.lower())
            vt = _base_vehicle(type_prefix.strip())
            if vt:
                vehicle_types.add(vt)
        # Body is at index 2 for most types, or index 1 as fallback.
        # Skip values that look like coordinates (no alphabetic chars).
        for i in (2, 1):
            if len(fields) > i and fields[i].strip():
                val = fields[i].strip()
                if any(c.isalpha() for c in val):
                    bodies.add(val.lower())
                    break

    return len(segments), len(bodies) > 1, len(systems) > 1, len(vehicle_types) > 1


def _parse_constraints(location: str, constraint_str: str, global_value: str) -> list[dict]:
    out: list[dict] = []
    for pair in constraint_str.split("**"):
        if "=" in pair:
            k, _, v = pair.partition("=")
        else:
            k, v = pair, global_value
        if k and v:
            try:
                out.append({"location": location, "key": k, "value": int(v)})
            except ValueError:
                pass
    return out


def _parse_last_updated(rows: list[list[str]]) -> dict[str, datetime]:
    result: dict[str, datetime] = {}
    for row in rows:
        if len(row) < 2:
            continue
        try:
            dt = datetime.strptime(row[1], TIME_FORMAT).replace(tzinfo=timezone.utc)
            result[row[0]] = dt
        except ValueError:
            log.warning("Cannot parse last-updated datetime: %s", row[1])
    return result


def _parse_result(key: str, row: list[Any]) -> dict | None:
    # Mixed types: index 4 is an integer (time in ms), rest are strings
    try:
        name = str(row[0])
        updated = str(row[1])
        ship = str(row[2])
        shipname = str(row[3])
        time_ms = int(row[4])
        # Validate the datetime
        datetime.strptime(updated, TIME_FORMAT)
        return {
            "name": name,
            "ship": ship,
            "shipname": shipname,
            "location": key,
            "time": time_ms,
            "updated": updated,
        }
    except (IndexError, ValueError, TypeError) as exc:
        log.warning("Skipping malformed result row for %s: %s — %s", key, row, exc)
        return None


# ---------------------------------------------------------------------------
# Database write helpers
# ---------------------------------------------------------------------------

async def _upsert_location(db: aiosqlite.Connection, loc: dict) -> None:
    await db.execute(
        """
        INSERT INTO locations (key, name, type, version, system, station, address, sort, coords)
        VALUES (:key, :name, :type, :version, :system, :station, :address, :sort, :coords)
        ON CONFLICT(key) DO UPDATE SET
            name    = excluded.name,
            type    = excluded.type,
            version = excluded.version,
            system  = excluded.system,
            station = excluded.station,
            address = excluded.address,
            sort    = excluded.sort,
            coords  = excluded.coords
        """,
        loc,
    )
    # Rebuild constraints: delete then insert
    await db.execute("DELETE FROM constraints WHERE location = ?", (loc["key"],))
    if loc["constraints"]:
        await db.executemany(
            "INSERT OR REPLACE INTO constraints (location, key, value) VALUES (:location, :key, :value)",
            loc["constraints"],
        )


async def _save_result(db: aiosqlite.Connection, result: dict) -> None:
    """Insert result (ignore duplicates). Keep only latest 2 per commander per location."""
    await db.execute(
        """
        INSERT OR IGNORE INTO results (name, ship, shipname, location, time, updated)
        VALUES (:name, :ship, :shipname, :location, :time, :updated)
        """,
        result,
    )
    # Prune: keep only the 2 most recent entries for this name+location
    await db.execute(
        """
        DELETE FROM results
        WHERE id NOT IN (
            SELECT id FROM results
            WHERE name = ? AND location = ?
            ORDER BY updated DESC
            LIMIT 2
        )
        AND name = ? AND location = ?
        """,
        (result["name"], result["location"], result["name"], result["location"]),
    )


async def _snapshot_positions(db: aiosqlite.Connection, key: str) -> None:
    """Snapshot current positions for all commanders in a race (on change only)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")

    # Compute current ranked positions from DB
    async with db.execute(
        """
        SELECT name, MIN(time) AS best
        FROM results
        WHERE location = ?
        GROUP BY name
        ORDER BY best
        """,
        (key,),
    ) as cur:
        ranked = await cur.fetchall()

    for pos, row in enumerate(ranked, start=1):
        name = row["name"]
        time_ms = row["best"]

        # Check last snapshot for this cmdr+location
        async with db.execute(
            """
            SELECT position, time_ms FROM position_snapshots
            WHERE location = ? AND name = ?
            ORDER BY snapped_at DESC
            LIMIT 1
            """,
            (key, name),
        ) as cur:
            last = await cur.fetchone()

        if last is None or last["position"] != pos or last["time_ms"] != time_ms:
            await db.execute(
                """
                INSERT INTO position_snapshots (location, name, position, time_ms, snapped_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (key, name, pos, time_ms, now),
            )


# ---------------------------------------------------------------------------
# Public import functions
# ---------------------------------------------------------------------------

async def fetch_and_store_locations() -> None:
    """Fetch the TT list from the API and upsert into the database."""
    async with httpx.AsyncClient() as client:
        rows = await _fetch(client, f"{BASE_URL}/getTTList/LEADERBOARD")

_SUPERSEDED_MARKERS = ("superseded", "do not use")


def _is_superseded(name: str) -> bool:
    """Return True if the race name indicates it is superseded/deprecated."""
    low = name.lower()
    return any(m in low for m in _SUPERSEDED_MARKERS)


async def fetch_and_store_locations() -> None:
    """Fetch the TT list from the API and upsert into the database."""
    async with httpx.AsyncClient() as client:
        rows = await _fetch(client, f"{BASE_URL}/getTTList/LEADERBOARD")

    locations = [_parse_location(r) for r in rows]
    db = await get_db()
    try:
        for loc in locations:
            if _is_superseded(loc["name"]):
                # Remove any previously stored superseded race (cascade cleans results/constraints)
                await db.execute("DELETE FROM locations WHERE key = ?", (loc["key"],))
                log.info("Removed superseded race: %s", loc["key"])
            else:
                await _upsert_location(db, loc)
        await db.commit()
        log.info("Upserted %d locations", sum(1 for l in locations if not _is_superseded(l["name"])))
    finally:
        await db.close()


async def fetch_and_store_results(key: str) -> None:
    """Fetch results for a single TT key and persist them."""
    async with httpx.AsyncClient() as client:
        rows = await _fetch(client, f"{BASE_URL}/getTTResults/LEADERBOARD<|>{key}")

    if not isinstance(rows, list):
        log.warning("Unexpected results payload for key %s", key)
        return

    results = [_parse_result(key, r) for r in rows]
    results = [r for r in results if r is not None]

    db = await get_db()
    try:
        for result in results:
            await _save_result(db, result)
        await db.commit()
        await _snapshot_positions(db, key)
        await db.commit()
        log.info("Stored %d results for %s", len(results), key)
    finally:
        await db.close()


async def fetch_last_updated() -> dict[str, datetime]:
    """Return the API's last-updated map without touching the database."""
    async with httpx.AsyncClient() as client:
        rows = await _fetch(client, f"{BASE_URL}/getTTResultsLU/LEADERBOARD")
    return _parse_last_updated(rows)


async def fetch_and_store_race_details() -> None:
    """Fetch getTTData for any locations not yet enriched (num_checkpoints = 0)."""
    db = await get_db()
    try:
        async with db.execute(
            "SELECT key FROM locations WHERE num_checkpoints = 0"
        ) as cursor:
            rows = await cursor.fetchall()
        keys = [row["key"] for row in rows]
    finally:
        await db.close()

    if not keys:
        log.info("All races already have detail data; skipping getTTData fetch.")
        return

    log.info("Fetching race details (getTTData) for %d races…", len(keys))
    from urllib.parse import quote as _quote

    async with httpx.AsyncClient() as client:
        for key in keys:
            encoded = _quote(f"LEADERBOARD<|>{key}")
            url = f"{BASE_URL}/getTTData/{encoded}"
            try:
                data = await _fetch(client, url)
                if not (isinstance(data, list) and data and isinstance(data[0], list) and len(data[0]) >= 2):
                    log.warning("Unexpected getTTData response for %s", key)
                    continue
                description: str = str(data[0][0])
                waypoints_str: str = str(data[0][1])
                num_cp, multi_planet, multi_system, multi_mode = _parse_ttdata(waypoints_str)
            except Exception as exc:
                log.error("Failed getTTData for %s: %s", key, exc)
                continue

            db = await get_db()
            try:
                await db.execute(
                    """
                    UPDATE locations
                    SET description = ?, num_checkpoints = ?, multi_planet = ?, multi_system = ?, multi_mode = ?
                    WHERE key = ?
                    """,
                    (description, num_cp, int(multi_planet), int(multi_system), int(multi_mode), key),
                )
                await db.commit()
            finally:
                await db.close()

    log.info("Race detail fetch complete for %d races.", len(keys))
