"""Query helpers for the leaderboard database."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

import aiosqlite

from .database import get_db


def _row_to_dict(row: aiosqlite.Row) -> dict:
    return dict(row)


# ---------------------------------------------------------------------------
# Races / locations
# ---------------------------------------------------------------------------

async def list_races(
    active_days: int | None = None,
    commander: str | None = None,
    commander_pos: str | None = None,
) -> list[dict]:
    """
    Return locations with a summary (latest result timestamp, entry count).

    active_days   – if set, only return races with at least one result updated
                    within the last N days.
    commander     – if set, only return races the given commander has competed in.
    commander_pos – if set, annotate each race with that commander's position
                    (without filtering the race list to their races). Ignored when
                    commander is also set (commander implies commander_pos).
    """
    db = await get_db()
    try:
        where_clauses: list[str] = []
        params: list[Any] = []

        pos_cmdr = commander or commander_pos
        cmdr_position_sql = ""
        cmdr_position_params: list[Any] = []
        if pos_cmdr:
            cmdr_position_sql = """,
                (
                    SELECT COUNT(*) + 1
                    FROM (
                        SELECT name, MIN(time) AS best
                        FROM results
                        WHERE location = l.key
                        GROUP BY name
                    ) t
                    WHERE t.best < (
                        SELECT MIN(time) FROM results
                        WHERE location = l.key AND name = ?
                    )
                ) AS cmdr_position"""
            cmdr_position_params = [pos_cmdr]

        base_sql = f"""
            SELECT
                l.key,
                l.name,
                l.type,
                l.version,
                l.system,
                l.station,
                l.address,
                l.sort,
                l.multi_mode,
                l.multi_planet,
                l.multi_system,
                (SELECT COUNT(DISTINCT name) FROM results
                 WHERE location = l.key)          AS entry_count,
                MAX(r.updated)                    AS last_activity
                {cmdr_position_sql}
            FROM locations l
            LEFT JOIN (
                SELECT name, location, MIN(time) AS time, MAX(updated) AS updated
                FROM results
                GROUP BY name, location
            ) r ON r.location = l.key
        """
        params = cmdr_position_params[:]

        if active_days is not None:
            cutoff = (
                datetime.now(timezone.utc) - timedelta(days=active_days)
            ).strftime("%Y-%m-%d %H:%M:%S.%f")
            where_clauses.append("r.updated >= ?")
            params.append(cutoff)

        if commander:
            where_clauses.append(
                "l.key IN (SELECT DISTINCT location FROM results WHERE name = ?)"
            )
            params.append(commander)

        if where_clauses:
            base_sql += " WHERE " + " AND ".join(where_clauses)

        base_sql += " GROUP BY l.key ORDER BY l.sort"

        async with db.execute(base_sql, params) as cursor:
            rows = await cursor.fetchall()

        races = []
        for row in rows:
            d = _row_to_dict(row)
            # Attach constraints
            async with db.execute(
                "SELECT key, value FROM constraints WHERE location = ?", (d["key"],)
            ) as c:
                d["constraints"] = [_row_to_dict(r) for r in await c.fetchall()]
            races.append(d)

        return races
    finally:
        await db.close()


async def get_race(key: str) -> dict | None:
    """Return a single race with full ranked results."""
    db = await get_db()
    try:
        async with db.execute(
            "SELECT * FROM locations WHERE key = ?", (key,)
        ) as cursor:
            row = await cursor.fetchone()

        if row is None:
            return None

        race = _row_to_dict(row)

        # Fetch constraints
        async with db.execute(
            "SELECT key, value FROM constraints WHERE location = ?", (key,)
        ) as cursor:
            race["constraints"] = [_row_to_dict(r) for r in await cursor.fetchall()]

        # Fetch results: best time per commander, plus their previous time
        async with db.execute(
            """
            SELECT id, name, ship, shipname, time, updated
            FROM results
            WHERE location = ?
            ORDER BY name, updated DESC
            """,
            (key,),
        ) as cursor:
            raw_results = await cursor.fetchall()

        # Group into best (first seen per name) and previous (second seen)
        best: dict[str, dict] = {}
        previous: dict[str, dict] = {}
        for r in raw_results:
            d = _row_to_dict(r)
            n = d["name"]
            if n not in best:
                best[n] = d
            elif n not in previous:
                previous[n] = d

        # Build ranked list sorted by best time
        ranked = sorted(best.values(), key=lambda x: x["time"])
        results = []
        prev_time: int | None = None
        for pos, entry in enumerate(ranked, start=1):
            name = entry["name"]
            prev = previous.get(name)
            improvement_ms: int | None = None
            if prev is not None:
                # improvement = previous best minus current best (positive = got faster)
                improvement_ms = prev["time"] - entry["time"]

            delta_ms: int | None = None
            if prev_time is not None:
                delta_ms = entry["time"] - prev_time
            prev_time = entry["time"]

            results.append({
                "position": pos,
                "name": name,
                "ship": entry["ship"],
                "shipname": entry["shipname"],
                "time_ms": entry["time"],
                "updated": entry["updated"],
                "improvement_ms": improvement_ms,
                "delta_ms": delta_ms,
            })

        race["results"] = results
        return race
    finally:
        await db.close()


async def list_commanders() -> list[str]:
    """Return a sorted list of all commander names known in the database."""
    db = await get_db()
    try:
        async with db.execute(
            "SELECT DISTINCT name FROM results ORDER BY name"
        ) as cursor:
            rows = await cursor.fetchall()
        return [row["name"] for row in rows]
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Commander stats page
# ---------------------------------------------------------------------------

async def get_commander_stats(commander: str) -> dict | None:
    """
    Return all races a commander has competed in, with per-race stats:
      position, total_entries, percentile (position/total*100, lower=better),
      improvement_ms, ship, shipname, last_competed.
    Also returns aggregate percentiles (overall + per type).
    """
    db = await get_db()
    try:
        # Check the commander exists
        async with db.execute(
            "SELECT 1 FROM results WHERE name = ? LIMIT 1", (commander,)
        ) as cur:
            if not await cur.fetchone():
                return None

        # Fetch all locations the commander has a result in
        async with db.execute(
            """
            SELECT l.key, l.name AS race_name, l.type, l.system, l.station
            FROM locations l
            WHERE l.key IN (SELECT DISTINCT location FROM results WHERE name = ?)
            ORDER BY l.type, l.sort
            """,
            (commander,),
        ) as cur:
            locations = [_row_to_dict(r) for r in await cur.fetchall()]

        races = []
        for loc in locations:
            key = loc["key"]

            # Commander's best and previous time for this race
            async with db.execute(
                """
                SELECT time, updated, ship, shipname
                FROM results
                WHERE location = ? AND name = ?
                ORDER BY updated DESC
                """,
                (key, commander),
            ) as cur:
                cmdr_rows = [_row_to_dict(r) for r in await cur.fetchall()]

            if not cmdr_rows:
                continue

            best_row = min(cmdr_rows, key=lambda r: r["time"])
            # previous = the one with the highest time (i.e. worst/older run)
            prev_row = max(cmdr_rows, key=lambda r: r["time"]) if len(cmdr_rows) > 1 else None
            improvement_ms: int | None = None
            if prev_row and prev_row["time"] != best_row["time"]:
                improvement_ms = prev_row["time"] - best_row["time"]

            # Total distinct commanders in this race
            async with db.execute(
                "SELECT COUNT(DISTINCT name) AS total FROM results WHERE location = ?",
                (key,),
            ) as cur:
                total_row = await cur.fetchone()
            total: int = total_row["total"] if total_row else 1

            # Commander's rank (1-based, by best time)
            async with db.execute(
                """
                SELECT COUNT(DISTINCT name) + 1 AS pos
                FROM (
                    SELECT name, MIN(time) AS best FROM results
                    WHERE location = ? GROUP BY name
                ) t
                WHERE t.best < ?
                """,
                (key, best_row["time"]),
            ) as cur:
                pos_row = await cur.fetchone()
            position: int = pos_row["pos"] if pos_row else 1

            percentile: float = round(position / total * 100, 1)

            races.append({
                "key": key,
                "race_name": loc["race_name"],
                "type": loc["type"],
                "system": loc["system"],
                "station": loc["station"],
                "position": position,
                "total_entries": total,
                "percentile": percentile,
                "improvement_ms": improvement_ms,
                "time_ms": best_row["time"],
                "ship": best_row["ship"],
                "shipname": best_row["shipname"],
                "last_competed": best_row["updated"],
            })

        if not races:
            return None

        # ── Aggregate percentiles ──────────────────────────────────────────
        overall_pct = round(sum(r["percentile"] for r in races) / len(races), 1)

        types = sorted({r["type"] for r in races})
        by_type: dict[str, float] = {}
        for t in types:
            t_races = [r for r in races if r["type"] == t]
            by_type[t] = round(sum(r["percentile"] for r in t_races) / len(t_races), 1)

        return {
            "commander": commander,
            "overall_percentile": overall_pct,
            "by_type_percentile": by_type,
            "races": races,
        }
    finally:
        await db.close()
