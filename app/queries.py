"""Query helpers for the leaderboard database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import aiosqlite

from .database import get_db


def _row_to_dict(row: aiosqlite.Row) -> dict:
    return dict(row)


# ---------------------------------------------------------------------------
# Races / locations
# ---------------------------------------------------------------------------


async def get_race_meta(key: str) -> dict | None:
    """Return just the name and description for a race (lightweight, for server-rendered head)."""
    db = await get_db()
    try:
        async with db.execute(
            "SELECT name, description FROM locations WHERE key = ?", (key,)
        ) as cursor:
            row = await cursor.fetchone()
        return _row_to_dict(row) if row else None
    finally:
        await db.close()


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
                CASE WHEN EXISTS(
                    SELECT 1 FROM results WHERE location = l.key AND name = ?
                ) THEN (
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
                ) ELSE NULL END AS cmdr_position"""
            cmdr_position_params = [pos_cmdr, pos_cmdr]

        base_sql = f"""
            SELECT
                l.key,
                l.name,
                l.description,
                l.type,
                l.version,
                l.system,
                l.station,
                l.address,
                l.sort,
                l.coords,
                l.creator,
                l.created_at,
                l.multi_mode,
                l.multi_planet,
                l.multi_system,
                l.tags,
                (SELECT COUNT(DISTINCT name) FROM results
                 WHERE location = l.key)          AS entry_count,
                MAX(r.updated)                    AS last_activity,
                CASE
                    WHEN dc.until_utc > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                    THEN dc.state
                    ELSE NULL
                END                               AS daylight_state
                {cmdr_position_sql}
            FROM locations l
            LEFT JOIN (
                SELECT name, location, MIN(time) AS time, MAX(updated) AS updated
                FROM results
                GROUP BY name, location
            ) r ON r.location = l.key
            LEFT JOIN daylight_cache dc ON dc.race_key = l.key
        """
        params = cmdr_position_params[:]

        if active_days is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=active_days)).strftime(
                "%Y-%m-%d %H:%M:%S.%f"
            )
            where_clauses.append("r.updated >= ?")
            params.append(cutoff)

        if commander:
            where_clauses.append("l.key IN (SELECT DISTINCT location FROM results WHERE name = ?)")
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
        async with db.execute("SELECT * FROM locations WHERE key = ?", (key,)) as cursor:
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

            results.append(
                {
                    "position": pos,
                    "name": name,
                    "ship": entry["ship"],
                    "shipname": entry["shipname"],
                    "time_ms": entry["time"],
                    "updated": entry["updated"],
                    "improvement_ms": improvement_ms,
                    "delta_ms": delta_ms,
                }
            )

        race["results"] = results

        # Check if creator is an actual commander (has results in the database)
        creator_is_cmdr = False
        if race.get("creator"):
            async with db.execute(
                "SELECT 1 FROM results WHERE name = ? LIMIT 1", (race["creator"],)
            ) as cursor:
                creator_is_cmdr = await cursor.fetchone() is not None
        race["creator_is_cmdr"] = creator_is_cmdr

        # ── Rivalry data ───────────────────────────────────────────────────
        # Count P1 changes in last day and last week using position_snapshots
        async with db.execute(
            """
            WITH p1 AS (
                SELECT name, snapped_at,
                    LAG(name) OVER (ORDER BY snapped_at) AS prev_name
                FROM position_snapshots
                WHERE location = ? AND position = 1
            )
            SELECT
                COUNT(CASE WHEN prev_name != name AND snapped_at >= datetime('now', '-1 day')  THEN 1 END) AS switches_day,
                COUNT(CASE WHEN prev_name != name AND snapped_at >= datetime('now', '-7 days') THEN 1 END) AS switches_week
            FROM p1
            WHERE prev_name IS NOT NULL
            """,
            (key,),
        ) as cur:
            sw_row = await cur.fetchone()

        rivalry = None
        if sw_row:
            switches_day = sw_row["switches_day"] or 0
            switches_week = sw_row["switches_week"] or 0
            if switches_week > 0:
                window = "day" if switches_day > 0 else "week"
                switches = switches_day if switches_day > 0 else switches_week
                since = (
                    "datetime('now', '-1 day')" if window == "day" else "datetime('now', '-7 days')"
                )
                async with db.execute(
                    f"""
                    SELECT DISTINCT name
                    FROM position_snapshots
                    WHERE location = ? AND position <= 3
                      AND snapped_at >= {since}
                    ORDER BY name
                    """,
                    (key,),
                ) as cur:
                    contender_rows = await cur.fetchall()
                contenders = [r["name"] for r in contender_rows]
                if len(contenders) >= 2:
                    rivalry = {
                        "switches": switches,
                        "window": window,
                        "contenders": contenders,
                    }

        race["rivalry"] = rivalry
        return race
    finally:
        await db.close()


async def list_commanders() -> list[str]:
    """Return a sorted list of all commander names known in the database."""
    db = await get_db()
    try:
        async with db.execute("SELECT DISTINCT name FROM results ORDER BY name") as cursor:
            rows = await cursor.fetchall()
        return [row["name"] for row in rows]
    finally:
        await db.close()


async def list_creators() -> list[dict]:
    """
    Return a list of all race creators with counts of races by type.
    Returns: [{"creator": str, "ship": int, "fighter": int, "srv": int, "onfoot": int, "total": int, "has_profile": bool}]
    """
    db = await get_db()
    try:
        async with db.execute(
            """
            SELECT
                creator,
                COUNT(*) AS total,
                SUM(CASE WHEN type = 'SHIP' THEN 1 ELSE 0 END) AS ship,
                SUM(CASE WHEN type = 'FIGHTER' THEN 1 ELSE 0 END) AS fighter,
                SUM(CASE WHEN type = 'SRV' THEN 1 ELSE 0 END) AS srv,
                SUM(CASE WHEN type = 'ONFOOT' THEN 1 ELSE 0 END) AS onfoot,
                EXISTS(SELECT 1 FROM results WHERE name = creator LIMIT 1) AS has_profile
            FROM locations
            WHERE creator IS NOT NULL AND creator != ''
            GROUP BY creator
            ORDER BY total DESC, creator ASC
            """
        ) as cursor:
            rows = await cursor.fetchall()
        return [_row_to_dict(row) for row in rows]
    finally:
        await db.close()


async def get_creator_races(creator: str, commander_pos: str | None = None) -> dict | None:
    """
    Return all races created by a specific commander, grouped by type.
    Returns None if the creator has no races.

    commander_pos – if set, annotate each race with that commander's position.
    """
    db = await get_db()
    try:
        cmdr_position_sql = ""
        cmdr_position_params: list[Any] = []
        if commander_pos:
            cmdr_position_sql = """,
                CASE WHEN EXISTS(
                    SELECT 1 FROM results WHERE location = l.key AND name = ?
                ) THEN (
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
                ) ELSE NULL END AS cmdr_position"""
            cmdr_position_params = [commander_pos, commander_pos]

        # Get all races by this creator
        async with db.execute(
            f"""
            SELECT
                l.key,
                l.name,
                l.type,
                l.version,
                l.system,
                l.station,
                l.address,
                l.sort,
                l.coords,
                l.creator,
                l.created_at,
                l.multi_mode,
                l.multi_planet,
                l.multi_system,
                l.tags,
                (SELECT COUNT(DISTINCT name) FROM results WHERE location = l.key) AS entry_count,
                MAX(r.updated) AS last_activity
                {cmdr_position_sql}
            FROM locations l
            LEFT JOIN (
                SELECT name, location, MIN(time) AS time, MAX(updated) AS updated
                FROM results
                GROUP BY name, location
            ) r ON r.location = l.key
            WHERE l.creator = ?
            GROUP BY l.key
            ORDER BY l.sort
            """,
            cmdr_position_params + [creator],
        ) as cursor:
            rows = await cursor.fetchall()

        if not rows:
            return None

        races = []
        for row in rows:
            d = _row_to_dict(row)
            # Attach constraints
            async with db.execute(
                "SELECT key, value FROM constraints WHERE location = ?", (d["key"],)
            ) as c:
                d["constraints"] = [_row_to_dict(r) for r in await c.fetchall()]
            races.append(d)

        return {"creator": creator, "races": races}
    finally:
        await db.close()


async def list_new_races(days: int = 7, commander: str | None = None) -> list[dict]:
    """Return races added within the last N days, ordered newest first.

    commander – if set, exclude races the given commander has already participated in.
    """
    db = await get_db()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime(
            "%Y-%m-%d %H:%M:%S.%f"
        )
        if commander:
            sql = """
                SELECT key, name, created_at
                FROM locations
                WHERE created_at >= ?
                  AND key NOT IN (
                      SELECT DISTINCT location FROM results WHERE name = ?
                  )
                ORDER BY created_at DESC
            """
            params: tuple = (cutoff, commander)
        else:
            sql = """
                SELECT key, name, created_at
                FROM locations
                WHERE created_at >= ?
                ORDER BY created_at DESC
            """
            params = (cutoff,)
        async with db.execute(sql, params) as cursor:
            rows = await cursor.fetchall()
        return [_row_to_dict(row) for row in rows]
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Commander stats page
# ---------------------------------------------------------------------------


async def get_commander_stats(commander: str) -> dict | None:
    """
    Return all races a commander has competed in, with per-race stats:
      position, total_entries, percentile (% of pilots beaten, higher=better),
      improvement_ms, ship, shipname, last_competed.
    Also returns aggregate percentiles (overall + per type).
    """
    db = await get_db()
    try:
        # Check the commander exists
        async with db.execute("SELECT 1 FROM results WHERE name = ? LIMIT 1", (commander,)) as cur:
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

            # Percentile now represents "percentage of pilots beaten"
            percentile: float = round((total - position) / total * 100, 1) if total > 0 else 0.0

            # Position delta: compare current position to oldest snapshot ≥7 days ago
            position_delta: int | None = None
            async with db.execute(
                """
                SELECT position FROM position_snapshots
                WHERE location = ? AND name = ?
                  AND snapped_at <= datetime('now', '-7 days')
                ORDER BY snapped_at DESC
                LIMIT 1
                """,
                (key, commander),
            ) as cur:
                snap = await cur.fetchone()
            if snap is not None:
                position_delta = snap["position"] - position  # positive = risen = better

            races.append(
                {
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
                    "position_delta": position_delta,
                }
            )

        if not races:
            return None

        # ── Aggregate percentiles ──────────────────────────────────────────
        # Calculate as: (total pilots beaten) / (total pilots faced) * 100
        # This naturally weights larger races more heavily and reflects actual competitive outcomes.
        total_beaten = sum(r["total_entries"] - r["position"] for r in races)
        total_faced = sum(r["total_entries"] for r in races)
        overall_pct = round((total_beaten / total_faced * 100), 1) if total_faced > 0 else 0.0

        types = sorted({r["type"] for r in races})
        by_type: dict[str, float] = {}
        for t in types:
            t_races = [r for r in races if r["type"] == t]
            t_beaten = sum(r["total_entries"] - r["position"] for r in t_races)
            t_faced = sum(r["total_entries"] for r in t_races)
            by_type[t] = round((t_beaten / t_faced * 100), 1) if t_faced > 0 else 0.0

        # ── Podium thefts ──────────────────────────────────────────────────
        # Detect when the commander was bumped off or down from a podium position.
        # For each event, identify who stole the position (same snapped_at batch).
        async with db.execute(
            """
            WITH cmdr_snaps AS (
                SELECT
                    location,
                    position,
                    snapped_at,
                    LAG(position)   OVER (PARTITION BY location ORDER BY snapped_at) AS prev_pos,
                    LAG(snapped_at) OVER (PARTITION BY location ORDER BY snapped_at) AS prev_snapped_at
                FROM position_snapshots
                WHERE name = ?
            )
            SELECT
                cs.location    AS race_key,
                l.name         AS race_name,
                cs.prev_pos    AS stolen_position,
                cs.position    AS new_position,
                cs.snapped_at  AS stolen_at,
                (
                    SELECT ps2.name
                    FROM position_snapshots ps2
                    WHERE ps2.location   = cs.location
                      AND ps2.snapped_at = cs.snapped_at
                      AND ps2.position   <= cs.prev_pos
                      AND NOT EXISTS (
                          SELECT 1
                          FROM position_snapshots ps3
                          WHERE ps3.location   = cs.location
                            AND ps3.snapped_at = cs.prev_snapped_at
                            AND ps3.name       = ps2.name
                            AND ps3.position   <= cs.prev_pos
                      )
                    ORDER BY ps2.position ASC
                    LIMIT 1
                ) AS thief_name,
                (
                    SELECT ps2.name
                    FROM position_snapshots ps2
                    WHERE ps2.location   = cs.location
                      AND ps2.snapped_at = cs.snapped_at
                      AND ps2.position   <= cs.prev_pos
                      AND NOT EXISTS (
                          SELECT 1
                          FROM position_snapshots ps3
                          WHERE ps3.location   = cs.location
                            AND ps3.snapped_at = cs.prev_snapped_at
                            AND ps3.name       = ps2.name
                            AND ps3.position   <= cs.prev_pos
                      )
                    ORDER BY ps2.position ASC
                    LIMIT 1
                ) AS thief_name_inner,
                (
                    SELECT ps_latest.position
                    FROM position_snapshots ps_latest
                    WHERE ps_latest.location = cs.location
                      AND ps_latest.name = (
                          SELECT ps2.name
                          FROM position_snapshots ps2
                          WHERE ps2.location   = cs.location
                            AND ps2.snapped_at = cs.snapped_at
                            AND ps2.position   <= cs.prev_pos
                            AND NOT EXISTS (
                                SELECT 1
                                FROM position_snapshots ps3
                                WHERE ps3.location   = cs.location
                                  AND ps3.snapped_at = cs.prev_snapped_at
                                  AND ps3.name       = ps2.name
                                  AND ps3.position   <= cs.prev_pos
                            )
                          ORDER BY ps2.position ASC
                          LIMIT 1
                      )
                    ORDER BY ps_latest.snapped_at DESC
                    LIMIT 1
                ) AS thief_current_position,
                (
                    SELECT ps_cmdr.position
                    FROM position_snapshots ps_cmdr
                    WHERE ps_cmdr.location = cs.location
                      AND ps_cmdr.name = ?
                    ORDER BY ps_cmdr.snapped_at DESC
                    LIMIT 1
                ) AS cmdr_current_position
            FROM cmdr_snaps cs
            JOIN locations l ON l.key = cs.location
            WHERE cs.prev_pos IS NOT NULL
              AND cs.prev_pos <= 3
              AND cs.position > cs.prev_pos
            ORDER BY cs.snapped_at DESC
            LIMIT 10
            """,
            (commander, commander),
        ) as cur:
            theft_rows = await cur.fetchall()

        # Exclude rows where we couldn't identify the thief and compute status flags
        podium_thefts = []
        for r in theft_rows:
            if not r["thief_name"]:
                continue

            row_dict = _row_to_dict(r)

            # Extract relevant positions
            thief_current = row_dict.get("thief_current_position")
            cmdr_current = row_dict.get("cmdr_current_position")
            stolen_pos = row_dict["stolen_position"]

            # Reclaimed: commander currently holds the stolen position or better
            reclaimed = cmdr_current is not None and cmdr_current <= stolen_pos

            # Thief lost: thief no longer holds the stolen position (or better)
            thief_lost = thief_current is not None and thief_current > stolen_pos

            # Redeemed: thief lost the trophy AND commander is now ahead of the thief
            redeemed = thief_lost and cmdr_current is not None and cmdr_current < thief_current

            row_dict["reclaimed"] = reclaimed
            row_dict["thief_lost"] = thief_lost
            row_dict["redeemed"] = redeemed

            # Clean up internal fields
            row_dict.pop("thief_name_inner", None)
            row_dict.pop("thief_current_position", None)
            row_dict.pop("cmdr_current_position", None)

            podium_thefts.append(row_dict)

        # ── Check if commander is a creator ────────────────────────────────
        # Count how many races they've created
        async with db.execute(
            "SELECT COUNT(*) AS count FROM locations WHERE creator = ?",
            (commander,),
        ) as cur:
            creator_row = await cur.fetchone()
        created_race_count = creator_row["count"] if creator_row else 0

        return {
            "commander": commander,
            "overall_percentile": overall_pct,
            "by_type_percentile": by_type,
            "races": races,
            "podium_thefts": podium_thefts,
            "created_race_count": created_race_count,
        }
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Recent activity
# ---------------------------------------------------------------------------


async def get_recent_activity(limit: int = 25, offset: int = 0) -> list[dict]:
    """
    Return the most recent race results with commander, race name, position, and timestamp.
    Uses results_history table to show ALL submissions (including multiple improvements
    by the same commander), with positions as they were at submission time.
    Includes improvement_ms: the time improvement from their previous submission on that race.
    Includes current_position: the commander's current position in that race (may differ from historical).
    """
    db = await get_db()
    try:
        async with db.execute(
            """
            WITH ranked_history AS (
                SELECT
                    rh.id,
                    rh.name,
                    rh.location,
                    l.name AS race_name,
                    l.system,
                    l.multi_system,
                    rh.position,
                    rh.time,
                    rh.updated,
                    LAG(rh.time) OVER (
                        PARTITION BY rh.name, rh.location
                        ORDER BY rh.updated
                    ) AS prev_time
                FROM results_history rh
                JOIN locations l ON l.key = rh.location
                WHERE rh.position IS NOT NULL
            ),
            current_positions AS (
                SELECT
                    location,
                    name,
                    MIN(time) as best_time,
                    ROW_NUMBER() OVER (PARTITION BY location ORDER BY MIN(time)) as current_position
                FROM results
                GROUP BY location, name
            )
            SELECT
                rh.name,
                rh.location,
                rh.race_name,
                rh.system,
                rh.multi_system,
                rh.position,
                rh.updated,
                CASE
                    WHEN rh.prev_time IS NOT NULL THEN rh.prev_time - rh.time
                    ELSE NULL
                END AS improvement_ms,
                cp.current_position
            FROM ranked_history rh
            LEFT JOIN current_positions cp ON cp.location = rh.location AND cp.name = rh.name
            ORDER BY rh.updated DESC, rh.id DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ) as cur:
            return [_row_to_dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def get_recent_thefts(days: int = 30) -> list[dict]:
    """
    Return recent podium position thefts/regains across all races.
    Shows when commanders lost or regained podium positions (top 3) in the last N days.

    Returns events where:
    - A commander was bumped off or down from a podium position (theft)
    - A commander regained a previously-held podium position (redemption)
    """
    db = await get_db()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime(
            "%Y-%m-%d %H:%M:%S.%f"
        )

        async with db.execute(
            """
            WITH position_changes AS (
                SELECT
                    ps.location,
                    ps.name AS victim_name,
                    ps.position AS new_position,
                    ps.snapped_at,
                    LAG(ps.position) OVER (PARTITION BY ps.location, ps.name ORDER BY ps.snapped_at) AS prev_position,
                    LAG(ps.snapped_at) OVER (PARTITION BY ps.location, ps.name ORDER BY ps.snapped_at) AS prev_snapped_at
                FROM position_snapshots ps
                WHERE ps.snapped_at >= ?
            ),
            thefts AS (
                SELECT
                    pc.location,
                    pc.victim_name,
                    pc.prev_position AS stolen_position,
                    pc.new_position,
                    pc.snapped_at AS stolen_at,
                    pc.prev_snapped_at,
                    -- Find who took the position (new commander at or above the stolen position)
                    (
                        SELECT ps2.name
                        FROM position_snapshots ps2
                        WHERE ps2.location = pc.location
                          AND ps2.snapped_at = pc.snapped_at
                          AND ps2.position <= pc.prev_position
                          AND NOT EXISTS (
                              SELECT 1
                              FROM position_snapshots ps3
                              WHERE ps3.location = pc.location
                                AND ps3.snapped_at = pc.prev_snapped_at
                                AND ps3.name = ps2.name
                                AND ps3.position <= pc.prev_position
                          )
                        ORDER BY ps2.position ASC
                        LIMIT 1
                    ) AS thief_name
                FROM position_changes pc
                WHERE pc.prev_position IS NOT NULL
                  AND pc.prev_position <= 3
                  AND pc.new_position > pc.prev_position
            )
            SELECT
                t.location AS race_key,
                l.name AS race_name,
                t.victim_name,
                t.thief_name,
                t.stolen_position,
                t.new_position,
                t.stolen_at,
                -- Get current positions for both parties
                (
                    SELECT ps.position
                    FROM position_snapshots ps
                    WHERE ps.location = t.location
                      AND ps.name = t.thief_name
                    ORDER BY ps.snapped_at DESC
                    LIMIT 1
                ) AS thief_current_position,
                (
                    SELECT ps.position
                    FROM position_snapshots ps
                    WHERE ps.location = t.location
                      AND ps.name = t.victim_name
                    ORDER BY ps.snapped_at DESC
                    LIMIT 1
                ) AS victim_current_position
            FROM thefts t
            JOIN locations l ON l.key = t.location
            WHERE t.thief_name IS NOT NULL
            ORDER BY t.stolen_at DESC
            """,
            (cutoff,),
        ) as cur:
            theft_rows = await cur.fetchall()

        # Process results to add computed flags
        results = []
        for r in theft_rows:
            row_dict = _row_to_dict(r)

            # Extract positions
            stolen_pos = row_dict["stolen_position"]
            thief_current = row_dict.get("thief_current_position")
            victim_current = row_dict.get("victim_current_position")

            # Reclaimed: victim currently holds the stolen position or better
            reclaimed = victim_current is not None and victim_current <= stolen_pos

            # Thief lost: thief no longer holds the stolen position (or better)
            thief_lost = thief_current is not None and thief_current > stolen_pos

            # Redeemed: thief lost the trophy AND victim is now ahead of the thief
            redeemed = thief_lost and victim_current is not None and victim_current < thief_current

            row_dict["reclaimed"] = reclaimed
            row_dict["thief_lost"] = thief_lost
            row_dict["redeemed"] = redeemed

            results.append(row_dict)

        return results
    finally:
        await db.close()


async def get_active_racers(limit: int = 25, offset: int = 0) -> list[dict]:
    """
    Return a distinct list of commanders ordered by when they last set a time on any race.
    Shows the commander name and their most recent submission timestamp across all races.
    """
    db = await get_db()
    try:
        async with db.execute(
            """
            SELECT
                rh.name,
                MAX(rh.updated) AS last_active
            FROM results_history rh
            WHERE rh.position IS NOT NULL
            GROUP BY rh.name
            ORDER BY MAX(rh.updated) DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ) as cur:
            return [_row_to_dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def get_active_racers_timeseries(days: int = 180) -> list[dict]:
    """
    Return a 7-day rolling average of active racers for the last N days
    (inclusive of today).

    "active" means a commander has at least one recorded submission on that day.
    """
    db = await get_db()
    try:
        safe_days = max(1, min(days, 3650))
        start_offset = f"-{safe_days - 1} days"

        async with db.execute(
            """
            WITH RECURSIVE days(day) AS (
                SELECT date('now', ?)
                UNION ALL
                SELECT date(day, '+1 day')
                FROM days
                WHERE day < date('now')
            ),
            daily_active AS (
                SELECT
                    date(rh.updated) AS day,
                    COUNT(DISTINCT rh.name) AS active_racers
                FROM results_history rh
                WHERE rh.position IS NOT NULL
                  AND date(rh.updated) >= date('now', ?)
                GROUP BY date(rh.updated)
            ),
            series AS (
                SELECT
                    d.day,
                    COALESCE(da.active_racers, 0) AS daily_active_racers
                FROM days d
                LEFT JOIN daily_active da ON da.day = d.day
            )
            SELECT
                s.day,
                ROUND(
                    AVG(s.daily_active_racers) OVER (
                        ORDER BY s.day
                        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
                    ),
                    2
                ) AS active_racers
            FROM series s
            ORDER BY s.day
            """,
            (start_offset, start_offset),
        ) as cur:
            return [_row_to_dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def get_visual_stats_extras(days: int = 365, months: int = 12) -> dict:
    """Return aggregated datasets used by the visual stats dashboard."""
    db = await get_db()
    try:
        safe_days = max(30, min(days, 3650))
        safe_months = max(3, min(months, 60))
        start_offset = f"-{safe_days - 1} days"
        months_offset = f"-{safe_months * 31} days"

        # Participation depth histogram (how many races each commander has entered)
        async with db.execute(
            """
            WITH per_cmdr AS (
                SELECT name, COUNT(DISTINCT location) AS races_entered
                FROM results
                GROUP BY name
            ),
            bucketed AS (
                SELECT
                    CASE
                        WHEN races_entered = 1 THEN '1'
                        WHEN races_entered = 2 THEN '2'
                        WHEN races_entered BETWEEN 3 AND 5 THEN '3-5'
                        WHEN races_entered BETWEEN 6 AND 10 THEN '6-10'
                        WHEN races_entered BETWEEN 11 AND 20 THEN '11-20'
                        WHEN races_entered BETWEEN 21 AND 50 THEN '21-50'
                        WHEN races_entered BETWEEN 51 AND 100 THEN '51-100'
                        ELSE '101+'
                    END AS bucket,
                    CASE
                        WHEN races_entered = 1 THEN 1
                        WHEN races_entered = 2 THEN 2
                        WHEN races_entered BETWEEN 3 AND 5 THEN 3
                        WHEN races_entered BETWEEN 6 AND 10 THEN 4
                        WHEN races_entered BETWEEN 11 AND 20 THEN 5
                        WHEN races_entered BETWEEN 21 AND 50 THEN 6
                        WHEN races_entered BETWEEN 51 AND 100 THEN 7
                        ELSE 8
                    END AS sort_order
                FROM per_cmdr
            )
            SELECT bucket, COUNT(*) AS count
            FROM bucketed
            GROUP BY bucket, sort_order
            ORDER BY sort_order
            """
        ) as cur:
            participation_depth = [_row_to_dict(r) for r in await cur.fetchall()]

        # Submission volume by day + 7-day rolling average
        async with db.execute(
            """
            WITH RECURSIVE days(day) AS (
                SELECT date('now', ?)
                UNION ALL
                SELECT date(day, '+1 day')
                FROM days
                WHERE day < date('now')
            ),
            daily AS (
                SELECT
                    date(rh.updated) AS day,
                    COUNT(*) AS submissions
                FROM results_history rh
                WHERE rh.position IS NOT NULL
                  AND date(rh.updated) >= date('now', ?)
                GROUP BY date(rh.updated)
            )
            SELECT
                d.day,
                COALESCE(dly.submissions, 0) AS submissions,
                ROUND(
                    AVG(COALESCE(dly.submissions, 0)) OVER (
                        ORDER BY d.day
                        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
                    ),
                    2
                ) AS submissions_7d_avg
            FROM days d
            LEFT JOIN daily dly ON dly.day = d.day
            ORDER BY d.day
            """,
            (start_offset, start_offset),
        ) as cur:
            submissions_trend = [_row_to_dict(r) for r in await cur.fetchall()]

        # Monthly theft, reclaimed, redeemed trend
        theft_events = await get_recent_thefts(days=max(31, safe_months * 31))

        now = datetime.now(timezone.utc)
        month_keys: list[str] = []
        for offset in range(safe_months - 1, -1, -1):
            month_index = now.year * 12 + (now.month - 1) - offset
            year = month_index // 12
            month = month_index % 12 + 1
            month_keys.append(f"{year:04d}-{month:02d}")

        monthly = {
            key: {
                "month": key,
                "label": datetime.strptime(key, "%Y-%m").strftime("%b %Y"),
                "thefts": 0,
                "reclaimed": 0,
                "redeemed": 0,
            }
            for key in month_keys
        }

        for event in theft_events:
            stolen_at = event.get("stolen_at")
            if not stolen_at:
                continue
            month_key = str(stolen_at)[:7]
            if month_key not in monthly:
                continue
            monthly[month_key]["thefts"] += 1
            if event.get("reclaimed"):
                monthly[month_key]["reclaimed"] += 1
            if event.get("redeemed"):
                monthly[month_key]["redeemed"] += 1

        thefts_trend = [monthly[key] for key in month_keys]

        # Leaderboard churn and underdog wins (P1 changes) trend
        async with db.execute(
            """
            WITH changes AS (
                SELECT
                    ps.location,
                    ps.position,
                    ps.snapped_at,
                    LAG(ps.position) OVER (
                        PARTITION BY ps.location, ps.name
                        ORDER BY ps.snapped_at
                    ) AS prev_position
                FROM position_snapshots ps
                WHERE ps.snapped_at >= date('now', ?)
            )
            SELECT
                substr(snapped_at, 1, 7) AS month,
                COUNT(*) AS all_changes,
                SUM(CASE WHEN position <= 3 OR prev_position <= 3 THEN 1 ELSE 0 END) AS top3_changes
            FROM changes
            WHERE prev_position IS NOT NULL
              AND prev_position != position
            GROUP BY substr(snapped_at, 1, 7)
            ORDER BY month
            """,
            (months_offset,),
        ) as cur:
            churn_rows = {_row_to_dict(r)["month"]: _row_to_dict(r) for r in await cur.fetchall()}

        async with db.execute(
            """
            WITH p1 AS (
                SELECT
                    location,
                    snapped_at,
                    name,
                    LAG(name) OVER (PARTITION BY location ORDER BY snapped_at) AS prev_name
                FROM position_snapshots
                WHERE position = 1
                  AND snapped_at >= date('now', ?)
            )
            SELECT
                substr(snapped_at, 1, 7) AS month,
                COUNT(*) AS underdog_wins
            FROM p1
            WHERE prev_name IS NOT NULL
              AND prev_name != name
            GROUP BY substr(snapped_at, 1, 7)
            ORDER BY month
            """,
            (months_offset,),
        ) as cur:
            p1_rows = {_row_to_dict(r)["month"]: _row_to_dict(r) for r in await cur.fetchall()}

        churn_trend = []
        for month in month_keys:
            churn_trend.append(
                {
                    "month": month,
                    "label": datetime.strptime(month, "%Y-%m").strftime("%b %Y"),
                    "all_changes": int((churn_rows.get(month) or {}).get("all_changes") or 0),
                    "top3_changes": int((churn_rows.get(month) or {}).get("top3_changes") or 0),
                    "underdog_wins": int((p1_rows.get(month) or {}).get("underdog_wins") or 0),
                }
            )

        # Improvement velocity trend (average positive improvement per month)
        async with db.execute(
            """
            WITH improved AS (
                SELECT
                    substr(rh.updated, 1, 7) AS month,
                    (LAG(rh.time) OVER (
                        PARTITION BY rh.name, rh.location
                        ORDER BY rh.updated
                    ) - rh.time) AS improvement_ms
                FROM results_history rh
                WHERE rh.position IS NOT NULL
                  AND rh.updated >= date('now', ?)
            )
            SELECT
                month,
                ROUND(AVG(improvement_ms), 1) AS avg_improvement_ms,
                COUNT(*) AS improvement_events
            FROM improved
            WHERE improvement_ms > 0
            GROUP BY month
            ORDER BY month
            """,
            (months_offset,),
        ) as cur:
            velocity_rows = {
                _row_to_dict(r)["month"]: _row_to_dict(r) for r in await cur.fetchall()
            }

        improvement_velocity = []
        for month in month_keys:
            row = velocity_rows.get(month) or {}
            improvement_velocity.append(
                {
                    "month": month,
                    "label": datetime.strptime(month, "%Y-%m").strftime("%b %Y"),
                    "avg_improvement_ms": float(row.get("avg_improvement_ms") or 0),
                    "improvement_events": int(row.get("improvement_events") or 0),
                }
            )

        # First-place stability (current P1 streak distribution and top races)
        async with db.execute(
            """
            SELECT location, name, snapped_at
            FROM position_snapshots
            WHERE position = 1
            ORDER BY location, snapped_at DESC
            """
        ) as cur:
            p1_all_rows = [_row_to_dict(r) for r in await cur.fetchall()]

        async with db.execute(
            """
            SELECT MIN(snapped_at) AS first_snapshot
            FROM position_snapshots
            WHERE position = 1
            """
        ) as cur:
            stability_since_row = _row_to_dict(await cur.fetchone())

        async with db.execute("SELECT key, name FROM locations") as cur:
            race_names = {r["key"]: r["name"] for r in await cur.fetchall()}

        from collections import defaultdict

        rows_by_location: dict[str, list[dict]] = defaultdict(list)
        for row in p1_all_rows:
            rows_by_location[row["location"]].append(row)

        stability_items = []
        now_utc = datetime.now(timezone.utc)
        for location, rows in rows_by_location.items():
            if not rows:
                continue
            current_name = rows[0]["name"]
            streak_start = rows[0]["snapped_at"]
            for row in rows:
                if row["name"] != current_name:
                    break
                streak_start = row["snapped_at"]

            try:
                streak_dt = datetime.strptime(str(streak_start), "%Y-%m-%d %H:%M:%S.%f").replace(
                    tzinfo=timezone.utc
                )
            except ValueError:
                try:
                    streak_dt = datetime.strptime(str(streak_start), "%Y-%m-%d %H:%M:%S").replace(
                        tzinfo=timezone.utc
                    )
                except ValueError:
                    continue

            streak_days = max(0, int((now_utc - streak_dt).total_seconds() // 86400))
            stability_items.append(
                {
                    "race_key": location,
                    "race_name": race_names.get(location, location),
                    "leader": current_name,
                    "streak_days": streak_days,
                }
            )

        stability_items.sort(key=lambda x: x["streak_days"], reverse=True)

        stability_since_label = None
        first_snapshot_raw = (
            stability_since_row.get("first_snapshot") if stability_since_row else None
        )
        if first_snapshot_raw:
            for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
                try:
                    stability_since_label = datetime.strptime(
                        str(first_snapshot_raw), fmt
                    ).strftime("%b %d, %Y")
                    break
                except ValueError:
                    continue

        bucket_defs = [
            ("0-7", 0, 7),
            ("8-30", 8, 30),
            ("31-90", 31, 90),
            ("91-180", 91, 180),
            ("181+", 181, 100000),
        ]
        stability_buckets = []
        for label, low, high in bucket_defs:
            count = sum(1 for item in stability_items if low <= item["streak_days"] <= high)
            stability_buckets.append({"bucket": label, "count": count})

        # Race freshness distribution
        async with db.execute(
            """
            SELECT
                l.key,
                l.name,
                MAX(r.updated) AS last_active
            FROM locations l
            LEFT JOIN results r ON r.location = l.key
            WHERE l.tags IS NULL OR l.tags NOT LIKE '%Inactive%'
            GROUP BY l.key
            """
        ) as cur:
            freshness_rows = [_row_to_dict(r) for r in await cur.fetchall()]

        freshness_counts = {"0-7": 0, "8-30": 0, "31-90": 0, "91-180": 0, "181+": 0, "never": 0}
        for row in freshness_rows:
            last_active = row.get("last_active")
            if not last_active:
                freshness_counts["never"] += 1
                continue
            try:
                dt = datetime.strptime(str(last_active), "%Y-%m-%d %H:%M:%S.%f").replace(
                    tzinfo=timezone.utc
                )
            except ValueError:
                dt = datetime.strptime(str(last_active), "%Y-%m-%d %H:%M:%S").replace(
                    tzinfo=timezone.utc
                )

            age_days = max(0, int((now_utc - dt).total_seconds() // 86400))
            if age_days <= 7:
                freshness_counts["0-7"] += 1
            elif age_days <= 30:
                freshness_counts["8-30"] += 1
            elif age_days <= 90:
                freshness_counts["31-90"] += 1
            elif age_days <= 180:
                freshness_counts["91-180"] += 1
            else:
                freshness_counts["181+"] += 1

        freshness_distribution = [
            {"bucket": "0-7", "count": freshness_counts["0-7"]},
            {"bucket": "8-30", "count": freshness_counts["8-30"]},
            {"bucket": "31-90", "count": freshness_counts["31-90"]},
            {"bucket": "91-180", "count": freshness_counts["91-180"]},
            {"bucket": "181+", "count": freshness_counts["181+"]},
            {"bucket": "Never", "count": freshness_counts["never"]},
        ]

        # Participation concentration
        async with db.execute(
            """
            SELECT name, COUNT(*) AS submissions
            FROM results_history
            WHERE position IS NOT NULL
            GROUP BY name
            ORDER BY submissions DESC
            """
        ) as cur:
            cmdr_submissions = [_row_to_dict(r) for r in await cur.fetchall()]

        total_submissions = sum(int(r["submissions"]) for r in cmdr_submissions)
        total_cmdrs = len(cmdr_submissions)
        top_10pct_n = max(1, int((total_cmdrs * 0.10) + 0.9999)) if total_cmdrs else 0
        top_25pct_n = max(1, int((total_cmdrs * 0.25) + 0.9999)) if total_cmdrs else 0

        top10_sum = sum(int(r["submissions"]) for r in cmdr_submissions[:top_10pct_n])
        top25_sum = sum(int(r["submissions"]) for r in cmdr_submissions[:top_25pct_n])

        participation_concentration = {
            "total_commanders": total_cmdrs,
            "total_submissions": total_submissions,
            "top_10pct_share": round((top10_sum / total_submissions * 100), 1)
            if total_submissions
            else 0,
            "top_25pct_share": round((top25_sum / total_submissions * 100), 1)
            if total_submissions
            else 0,
        }

        # Time-to-first-competition by race creation cohort
        async with db.execute(
            """
            SELECT
                l.key,
                substr(l.created_at, 1, 7) AS cohort_month,
                l.created_at,
                (
                    SELECT MAX(x.updated)
                    FROM (
                        SELECT MIN(rh.updated) AS updated
                        FROM results_history rh
                        WHERE rh.location = l.key
                        GROUP BY rh.name
                        ORDER BY MIN(rh.updated)
                        LIMIT 2
                    ) x
                ) AS second_cmdr_at
            FROM locations l
            WHERE l.created_at IS NOT NULL
              AND l.created_at != ''
            """
        ) as cur:
            cohort_rows = [_row_to_dict(r) for r in await cur.fetchall()]

        cohort_acc: dict[str, dict] = {}
        for row in cohort_rows:
            cohort = row.get("cohort_month")
            created_at = row.get("created_at")
            second_at = row.get("second_cmdr_at")
            if not cohort or not created_at:
                continue
            if cohort not in cohort_acc:
                cohort_acc[cohort] = {"cohort_month": cohort, "sum_days": 0.0, "count": 0}
            if not second_at:
                continue

            try:
                created_dt = datetime.strptime(str(created_at), "%Y-%m-%d %H:%M:%S.%f")
            except ValueError:
                created_dt = datetime.strptime(str(created_at), "%Y-%m-%d %H:%M:%S")
            try:
                second_dt = datetime.strptime(str(second_at), "%Y-%m-%d %H:%M:%S.%f")
            except ValueError:
                second_dt = datetime.strptime(str(second_at), "%Y-%m-%d %H:%M:%S")

            days_to_second = max(0.0, (second_dt - created_dt).total_seconds() / 86400.0)
            cohort_acc[cohort]["sum_days"] += days_to_second
            cohort_acc[cohort]["count"] += 1

        time_to_first_competition = []
        for cohort in sorted(cohort_acc.keys()):
            item = cohort_acc[cohort]
            cnt = int(item["count"])
            time_to_first_competition.append(
                {
                    "month": cohort,
                    "label": datetime.strptime(cohort, "%Y-%m").strftime("%b %Y"),
                    "avg_days_to_second": round((item["sum_days"] / cnt), 1) if cnt else 0,
                    "sample_size": cnt,
                }
            )

        # Race participant grouping buckets (by unique commanders per race)
        async with db.execute(
            """
            WITH per_race AS (
                SELECT
                    l.key,
                    COUNT(DISTINCT r.name) AS participants
                FROM locations l
                LEFT JOIN results r ON r.location = l.key
                WHERE l.tags IS NULL OR l.tags NOT LIKE '%Inactive%'
                GROUP BY l.key
            )
            SELECT
                SUM(CASE WHEN participants = 0 THEN 1 ELSE 0 END) AS g0,
                SUM(CASE WHEN participants = 1 THEN 1 ELSE 0 END) AS g1,
                SUM(CASE WHEN participants BETWEEN 2 AND 4 THEN 1 ELSE 0 END) AS g2_4,
                SUM(CASE WHEN participants BETWEEN 5 AND 9 THEN 1 ELSE 0 END) AS g5_9,
                SUM(CASE WHEN participants >= 10 THEN 1 ELSE 0 END) AS g10
            FROM per_race
            """
        ) as cur:
            participant_groups_row = _row_to_dict(await cur.fetchone())

        race_participant_groups = [
            {"bucket": "0", "count": int(participant_groups_row.get("g0") or 0)},
            {"bucket": "1", "count": int(participant_groups_row.get("g1") or 0)},
            {"bucket": "2-4", "count": int(participant_groups_row.get("g2_4") or 0)},
            {"bucket": "5-9", "count": int(participant_groups_row.get("g5_9") or 0)},
            {"bucket": "10+", "count": int(participant_groups_row.get("g10") or 0)},
        ]

        # Mode/type activity mix over time
        async with db.execute(
            """
            SELECT
                substr(rh.updated, 1, 7) AS month,
                l.type,
                COUNT(*) AS submissions
            FROM results_history rh
            JOIN locations l ON l.key = rh.location
            WHERE rh.position IS NOT NULL
              AND rh.updated >= date('now', ?)
            GROUP BY month, l.type
            ORDER BY month
            """,
            (months_offset,),
        ) as cur:
            mix_rows = [_row_to_dict(r) for r in await cur.fetchall()]

        mix_by_month = {
            m: {
                "month": m,
                "label": datetime.strptime(m, "%Y-%m").strftime("%b %Y"),
                "SRV": 0,
                "SHIP": 0,
                "FIGHTER": 0,
                "ONFOOT": 0,
            }
            for m in month_keys
        }
        for row in mix_rows:
            month = row.get("month")
            type_key = str(row.get("type") or "").upper()
            if month in mix_by_month and type_key in mix_by_month[month]:
                mix_by_month[month][type_key] = int(row.get("submissions") or 0)
        mode_activity_mix = [mix_by_month[m] for m in month_keys]

        # Commander retention cohorts (M+1, M+2, M+3)
        async with db.execute(
            """
            WITH cmdr_months AS (
                SELECT DISTINCT name, substr(updated, 1, 7) AS month
                FROM results_history
                WHERE position IS NOT NULL
            ),
            first_month AS (
                SELECT name, MIN(month) AS cohort_month
                FROM cmdr_months
                GROUP BY name
            )
            SELECT cm.name, fm.cohort_month, cm.month AS active_month
            FROM cmdr_months cm
            JOIN first_month fm ON fm.name = cm.name
            """
        ) as cur:
            retention_rows = [_row_to_dict(r) for r in await cur.fetchall()]

        def _add_month(month_str: str, delta: int) -> str:
            y, m = month_str.split("-")
            total = int(y) * 12 + (int(m) - 1) + delta
            ny = total // 12
            nm = total % 12 + 1
            return f"{ny:04d}-{nm:02d}"

        cohort_members: dict[str, set[str]] = {}
        active_by_cmdr: dict[str, set[str]] = {}
        for row in retention_rows:
            name = row["name"]
            cohort = row["cohort_month"]
            active_month = row["active_month"]
            cohort_members.setdefault(cohort, set()).add(name)
            active_by_cmdr.setdefault(name, set()).add(active_month)

        commander_retention = []
        for cohort in sorted(cohort_members.keys()):
            members = cohort_members[cohort]
            size = len(members)
            if size == 0:
                continue

            m1_month = _add_month(cohort, 1)
            m1_retained = sum(1 for n in members if m1_month in active_by_cmdr.get(n, set()))
            m1 = round((m1_retained / size) * 100, 1)

            m2_month = _add_month(cohort, 2)
            m2_retained = sum(1 for n in members if m2_month in active_by_cmdr.get(n, set()))
            m2 = round((m2_retained / size) * 100, 1)

            m3_month = _add_month(cohort, 3)
            m3_retained = sum(1 for n in members if m3_month in active_by_cmdr.get(n, set()))
            m3 = round((m3_retained / size) * 100, 1)

            commander_retention.append(
                {
                    "cohort_month": cohort,
                    "label": datetime.strptime(cohort, "%Y-%m").strftime("%b %Y"),
                    "cohort_size": size,
                    "m1": m1,
                    "m2": m2,
                    "m3": m3,
                }
            )

        # Rivalry intensity index
        async with db.execute(
            """
            WITH p1 AS (
                SELECT
                    location,
                    snapped_at,
                    name,
                    LAG(name) OVER (PARTITION BY location ORDER BY snapped_at) AS prev_name
                FROM position_snapshots
                WHERE position = 1
                  AND snapped_at >= datetime('now', '-30 days')
            )
            SELECT location, COUNT(*) AS switches_30d
            FROM p1
            WHERE prev_name IS NOT NULL
              AND prev_name != name
            GROUP BY location
            """
        ) as cur:
            switches_by_location = {
                r["location"]: int(r["switches_30d"] or 0) for r in await cur.fetchall()
            }

        async with db.execute(
            """
            WITH best AS (
                SELECT location, name, MIN(time) AS best_time
                FROM results
                GROUP BY location, name
            ),
            ranked AS (
                SELECT
                    location,
                    name,
                    best_time,
                    ROW_NUMBER() OVER (PARTITION BY location ORDER BY best_time) AS pos
                FROM best
            )
            SELECT
                l.key AS race_key,
                l.name AS race_name,
                MAX(CASE WHEN r.pos = 1 THEN r.best_time END) AS t1,
                MAX(CASE WHEN r.pos = 3 THEN r.best_time END) AS t3,
                COUNT(*) AS participants
            FROM ranked r
            JOIN locations l ON l.key = r.location
            WHERE r.pos <= 3
            GROUP BY l.key
            HAVING participants >= 3
            """
        ) as cur:
            rivalry_rows = [_row_to_dict(r) for r in await cur.fetchall()]

        rivalry_intensity = []
        for row in rivalry_rows:
            race_key = row["race_key"]
            t1 = int(row.get("t1") or 0)
            t3 = int(row.get("t3") or 0)
            if t1 <= 0 or t3 <= 0:
                continue
            switches = switches_by_location.get(race_key, 0)
            switch_score = min(switches / 5.0, 1.0)
            compression_score = max(0.0, 1.0 - ((t3 - t1) / max(t1, 1)))
            intensity = round((switch_score * 0.6 + compression_score * 0.4) * 100, 1)
            rivalry_intensity.append(
                {
                    "race_key": race_key,
                    "race_name": row.get("race_name") or race_key,
                    "switches_30d": switches,
                    "intensity": intensity,
                }
            )
        rivalry_intensity.sort(key=lambda x: x["intensity"], reverse=True)
        rivalry_intensity = rivalry_intensity[:15]

        # Submission heatmap (weekday/hour)
        async with db.execute(
            """
            SELECT
                CAST(strftime('%w', updated) AS INTEGER) AS dow,
                CAST(strftime('%H', updated) AS INTEGER) AS hour,
                COUNT(*) AS count
            FROM results_history
            WHERE position IS NOT NULL
              AND updated >= date('now', ?)
            GROUP BY dow, hour
            ORDER BY dow, hour
            """,
            (months_offset,),
        ) as cur:
            heat_rows = [_row_to_dict(r) for r in await cur.fetchall()]

        heat_lookup = {(int(r["dow"]), int(r["hour"])): int(r["count"]) for r in heat_rows}
        submission_heatmap = []
        for dow in range(7):
            row = {"dow": dow, "hours": []}
            for hour in range(24):
                row["hours"].append(heat_lookup.get((dow, hour), 0))
            submission_heatmap.append(row)

        return {
            "participation_depth": participation_depth,
            "submissions_trend": submissions_trend,
            "thefts_trend": thefts_trend,
            "churn_trend": churn_trend,
            "improvement_velocity": improvement_velocity,
            "first_place_stability": {
                "buckets": stability_buckets,
                "top_stable": stability_items[:15],
                "since_label": stability_since_label,
            },
            "race_freshness_distribution": freshness_distribution,
            "participation_concentration": participation_concentration,
            "time_to_first_competition": time_to_first_competition,
            "race_participant_groups": race_participant_groups,
            "mode_activity_mix": mode_activity_mix,
            "commander_retention": commander_retention,
            "rivalry_intensity": rivalry_intensity,
            "submission_heatmap": submission_heatmap,
        }
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Leaderboard statistics
# ---------------------------------------------------------------------------


async def get_stats() -> dict:
    """
    Return comprehensive leaderboard statistics.
    Includes single-value stats and top-N tables.
    """
    return await get_stats_with_limit(limit=6)


async def get_stats_with_limit(limit: int = 6) -> dict:
    """
    Return comprehensive leaderboard statistics.
    Includes single-value stats and top-N tables.
    """
    db = await get_db()
    try:
        stats: dict[str, Any] = {}

        # ── Single-value stats ─────────────────────────────────────────────

        # Total races (excluding races tagged as Inactive)
        async with db.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM locations
            WHERE tags IS NULL OR tags NOT LIKE '%Inactive%'
            """
        ) as cur:
            stats["total_races"] = (await cur.fetchone())["cnt"]

        # DW3 races (excluding races tagged as Inactive)
        async with db.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM locations
            WHERE tags LIKE '%DW3%'
              AND (tags IS NULL OR tags NOT LIKE '%Inactive%')
            """
        ) as cur:
            stats["dw3_races"] = (await cur.fetchone())["cnt"]

        # Non-DW3 races (excluding races tagged as Inactive)
        async with db.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM locations
            WHERE tags NOT LIKE '%DW3%'
              AND (tags IS NULL OR tags NOT LIKE '%Inactive%')
            """
        ) as cur:
            stats["non_dw3_races"] = (await cur.fetchone())["cnt"]

        # Total racers (distinct commanders)
        async with db.execute("SELECT COUNT(DISTINCT name) AS cnt FROM results") as cur:
            stats["total_racers"] = (await cur.fetchone())["cnt"]

        # DW3 racers (distinct commanders who raced in DW3 races)
        async with db.execute(
            """
            SELECT COUNT(DISTINCT r.name) AS cnt
            FROM results r
            JOIN locations l ON r.location = l.key
            WHERE l.tags LIKE '%DW3%'
            """
        ) as cur:
            stats["dw3_racers"] = (await cur.fetchone())["cnt"]

        # Non-DW3 racers (distinct commanders who raced in non-DW3 races)
        async with db.execute(
            """
            SELECT COUNT(DISTINCT r.name) AS cnt
            FROM results r
            JOIN locations l ON r.location = l.key
            WHERE l.tags NOT LIKE '%DW3%'
            """
        ) as cur:
            stats["non_dw3_racers"] = (await cur.fetchone())["cnt"]

        # Total contributors (distinct race creators)
        async with db.execute(
            "SELECT COUNT(DISTINCT creator) AS cnt FROM locations WHERE creator != ''"
        ) as cur:
            stats["total_contributors"] = (await cur.fetchone())["cnt"]

        # Active races (activity in last 30 days, excluding races tagged as Inactive)
        cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).strftime(
            "%Y-%m-%d %H:%M:%S.%f"
        )
        async with db.execute(
            """
            SELECT COUNT(DISTINCT location) AS cnt
            FROM results r
            JOIN locations l ON l.key = r.location
            WHERE r.updated >= ?
              AND (l.tags IS NULL OR l.tags NOT LIKE '%Inactive%')
            """,
            (cutoff_30d,),
        ) as cur:
            stats["active_races_30d"] = (await cur.fetchone())["cnt"]

            # Race counts by vehicle type, excluding races tagged as Inactive
        async with db.execute(
            """
                        SELECT COUNT(*) AS cnt
                        FROM locations l
                        WHERE l.type = 'SRV'
                            AND (l.tags IS NULL OR l.tags NOT LIKE '%Inactive%')
            """,
        ) as cur:
            stats["srv_races"] = (await cur.fetchone())["cnt"]

        async with db.execute(
            """
                        SELECT COUNT(*) AS cnt
                        FROM locations l
                        WHERE l.type = 'SHIP'
                            AND (l.tags IS NULL OR l.tags NOT LIKE '%Inactive%')
            """,
        ) as cur:
            stats["ship_races"] = (await cur.fetchone())["cnt"]

        async with db.execute(
            """
                        SELECT COUNT(*) AS cnt
                        FROM locations l
                        WHERE l.type = 'FIGHTER'
                            AND (l.tags IS NULL OR l.tags NOT LIKE '%Inactive%')
            """,
        ) as cur:
            stats["fighter_races"] = (await cur.fetchone())["cnt"]

        async with db.execute(
            """
                        SELECT COUNT(*) AS cnt
                        FROM locations l
                        WHERE l.type = 'ONFOOT'
                            AND (l.tags IS NULL OR l.tags NOT LIKE '%Inactive%')
            """,
        ) as cur:
            stats["onfoot_races"] = (await cur.fetchone())["cnt"]

        # Active racers (distinct commanders with activity in last 30 days)
        async with db.execute(
            """
            SELECT COUNT(DISTINCT name) AS cnt
            FROM results
            WHERE updated >= ?
            """,
            (cutoff_30d,),
        ) as cur:
            stats["active_racers_30d"] = (await cur.fetchone())["cnt"]

        # Longest race (by fastest participant's time)
        async with db.execute(
            """
            SELECT l.key, l.name, MIN(r.time) AS fastest_time_ms
            FROM locations l
            JOIN results r ON r.location = l.key
            GROUP BY l.key
            ORDER BY fastest_time_ms DESC
            LIMIT 1
            """
        ) as cur:
            row = await cur.fetchone()
            stats["longest_race"] = _row_to_dict(row) if row else None

        # Shortest race (by fastest participant's time)
        async with db.execute(
            """
            SELECT l.key, l.name, MIN(r.time) AS fastest_time_ms
            FROM locations l
            JOIN results r ON r.location = l.key
            GROUP BY l.key
            ORDER BY fastest_time_ms ASC
            LIMIT 1
            """
        ) as cur:
            row = await cur.fetchone()
            stats["shortest_race"] = _row_to_dict(row) if row else None

        # Most perseverance (commander with longest single result time)
        async with db.execute(
            """
            SELECT r.name, r.location, l.name AS race_name, r.time AS time_ms
            FROM results r
            JOIN locations l ON l.key = r.location
            ORDER BY r.time DESC
            LIMIT 1
            """
        ) as cur:
            row = await cur.fetchone()
            stats["most_perseverance"] = _row_to_dict(row) if row else None

        # ── Top-N tables ───────────────────────────────────────────────────

        # Most races created (by contributor)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    creator AS name,
                    COUNT(*) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
                FROM locations
                WHERE creator != ''
                GROUP BY creator
            )
            SELECT name, count
            FROM ranked
            WHERE rank <= ?
            ORDER BY count DESC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["top_creators"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Systems containing the most races
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    system,
                    COUNT(*) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
                FROM locations
                WHERE system != ''
                GROUP BY system
            )
            SELECT system, count
            FROM ranked
            WHERE rank <= ?
              AND (? > 6 OR count >= 5)
            ORDER BY count DESC, system ASC
            """,
            (limit, limit),
        ) as cur:
            stats["top_systems"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Most gold medals (1st place finishes)
        async with db.execute(
            """
            WITH best_times AS (
                SELECT location, name, MIN(time) AS best
                FROM results
                GROUP BY location, name
            ),
            winners AS (
                SELECT bt.location, bt.name
                FROM best_times bt
                WHERE bt.best = (
                    SELECT MIN(best) FROM best_times WHERE location = bt.location
                )
            ),
            ranked AS (
                SELECT
                    name,
                    COUNT(*) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
                FROM winners
                GROUP BY name
            )
            SELECT name, count
            FROM ranked
            WHERE rank <= ?
            ORDER BY count DESC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["top_gold_medals"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Most podium finishes (top 3)
        async with db.execute(
            """
            WITH best_times AS (
                SELECT location, name, MIN(time) AS best
                FROM results
                GROUP BY location, name
            ),
            positions AS (
                SELECT
                    location,
                    name,
                    RANK() OVER (PARTITION BY location ORDER BY best ASC) AS position
                FROM best_times
            ),
            ranked AS (
                SELECT
                    name,
                    COUNT(*) AS count,
                    SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END) AS gold,
                    SUM(CASE WHEN position = 2 THEN 1 ELSE 0 END) AS silver,
                    SUM(CASE WHEN position = 3 THEN 1 ELSE 0 END) AS bronze,
                    DENSE_RANK() OVER (ORDER BY SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END) DESC, SUM(CASE WHEN position = 2 THEN 1 ELSE 0 END) DESC, SUM(CASE WHEN position = 3 THEN 1 ELSE 0 END) DESC) AS rank
                FROM positions
                WHERE position <= 3
                GROUP BY name
            )
            SELECT name, count, gold, silver, bronze
            FROM ranked
            WHERE rank <= ?
            ORDER BY gold DESC, silver DESC, bronze DESC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["top_podium_finishes"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Most dedicated racer (participated in most different races)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    name,
                    COUNT(DISTINCT location) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT location) DESC) AS rank
                FROM results
                GROUP BY name
            )
            SELECT name, count
            FROM ranked
            WHERE rank <= ?
            ORDER BY count DESC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["top_dedicated_racers"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Most competitive races (most unique participants)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    l.key,
                    l.name,
                    l.type,
                    l.version,
                    l.tags,
                    COUNT(DISTINCT r.name) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT r.name) DESC) AS rank
                FROM locations l
                JOIN results r ON r.location = l.key
                GROUP BY l.key
            )
            SELECT key, name, type, version, tags, count
            FROM ranked
            WHERE rank <= ?
            ORDER BY count DESC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["top_competitive_races"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Least competitive races (fewest unique participants, minimum 1)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    l.key,
                    l.name,
                    l.type,
                    l.version,
                                        l.tags,
                    COUNT(DISTINCT r.name) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT r.name) ASC) AS rank
                FROM locations l
                JOIN results r ON r.location = l.key
                GROUP BY l.key
            )
                        SELECT key, name, type, version, tags, count
            FROM ranked
            WHERE rank <= ?
              AND (? > 6 OR count <= 4)
            ORDER BY count ASC, name ASC
            """,
            (limit, limit),
        ) as cur:
            stats["least_competitive_races"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Races most popular with one-time participants (cmdrs who entered only one race ever)
        async with db.execute(
            """
            WITH one_timers AS (
                SELECT name
                FROM results
                GROUP BY name
                HAVING COUNT(DISTINCT location) = 1
            ),
            ranked AS (
                SELECT
                    l.key,
                    l.name,
                    l.type,
                    l.version,
                    l.tags,
                    COUNT(DISTINCT r.name) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT r.name) DESC) AS rank
                FROM results r
                JOIN one_timers ot ON r.name = ot.name
                JOIN locations l ON l.key = r.location
                GROUP BY r.location
            )
            SELECT key, name, type, version, tags, count
            FROM ranked
            WHERE rank <= ?
            ORDER BY count DESC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["one_timer_races"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Least recently active races (by last result submitted, oldest first)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    l.key,
                    l.name,
                    l.type,
                    l.version,
                    l.tags,
                    MAX(r.updated) AS last_active,
                    DENSE_RANK() OVER (ORDER BY MAX(r.updated) ASC) AS rank
                FROM locations l
                JOIN results r ON r.location = l.key
                GROUP BY l.key
            )
            SELECT key, name, type, version, tags, last_active
            FROM ranked
            WHERE rank <= ?
            ORDER BY last_active ASC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["least_recently_active_races"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Most recently active commanders (by last result submitted)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    name,
                    MAX(updated) AS last_active,
                    DENSE_RANK() OVER (ORDER BY MAX(updated) DESC) AS rank
                FROM results
                GROUP BY name
            )
            SELECT name, last_active
            FROM ranked
            WHERE rank <= ?
            ORDER BY last_active DESC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["top_recently_active_cmdrs"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Most recently active races (by last result submitted)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    l.key,
                    l.name,
                    MAX(r.updated) AS last_active,
                    DENSE_RANK() OVER (ORDER BY MAX(r.updated) DESC) AS rank
                FROM locations l
                JOIN results r ON r.location = l.key
                GROUP BY l.key
            )
            SELECT key, name, last_active
            FROM ranked
            WHERE rank <= ?
            ORDER BY last_active DESC, name ASC
            """,
            (limit,),
        ) as cur:
            stats["top_recently_active_races"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Most popular ship type (for SHIP races)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    r.ship,
                    COUNT(DISTINCT r.name || '|' || r.location) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT r.name || '|' || r.location) DESC) AS rank
                FROM results r
                JOIN locations l ON l.key = r.location
                WHERE l.type = 'SHIP'
                    AND r.ship != ''
                    AND r.ship NOT LIKE '%SRV%'
                    AND r.ship NOT LIKE '%Scarabée%'
                    AND r.ship NOT LIKE '%On Foot%'
                GROUP BY r.ship
            )
            SELECT ship, count
            FROM ranked
            WHERE rank <= ?
            ORDER BY count DESC, ship ASC
            """,
            (limit,),
        ) as cur:
            stats["top_ship_types"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Most popular fighter type (for FIGHTER races)
        async with db.execute(
            """
            WITH ranked AS (
                SELECT
                    r.ship,
                    COUNT(DISTINCT r.name || '|' || r.location) AS count,
                    DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT r.name || '|' || r.location) DESC) AS rank
                FROM results r
                JOIN locations l ON l.key = r.location
                WHERE l.type = 'FIGHTER' AND r.ship != ''
                GROUP BY r.ship
            )
            SELECT ship, count
            FROM ranked
            WHERE rank <= ?
            ORDER BY count DESC, ship ASC
            """,
            (limit,),
        ) as cur:
            stats["top_fighter_types"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Popular ship names (player-assigned) shared by more than one commander.
        # Group case-insensitively and display in simple Title Case.
        async with db.execute(
            """
            WITH ship_owners AS (
                SELECT DISTINCT
                    LOWER(TRIM(shipname)) AS ship_key,
                    name
                FROM results
                WHERE shipname IS NOT NULL
                  AND TRIM(shipname) != ''
            ),
            ship_counts AS (
                SELECT
                    ship_key,
                    COUNT(*) AS commanders
                FROM ship_owners
                GROUP BY ship_key
                HAVING COUNT(*) > 1
            ),
            ranked AS (
                SELECT
                    ship_key,
                    commanders,
                    DENSE_RANK() OVER (ORDER BY commanders DESC) AS rank
                FROM ship_counts
            )
            SELECT ship_key, commanders
            FROM ranked
            WHERE rank <= ?
            ORDER BY commanders DESC, ship_key ASC
            """,
            (limit,),
        ) as cur:
            rows = await cur.fetchall()

        ship_keys = [r["ship_key"] for r in rows]
        commanders_by_key: dict[str, list[str]] = {k: [] for k in ship_keys}

        if ship_keys:
            placeholders = ",".join(["?"] * len(ship_keys))
            async with db.execute(
                f"""
                WITH ship_owners AS (
                    SELECT DISTINCT
                        LOWER(TRIM(shipname)) AS ship_key,
                        name
                    FROM results
                    WHERE shipname IS NOT NULL
                      AND TRIM(shipname) != ''
                )
                SELECT ship_key, name
                FROM ship_owners
                WHERE ship_key IN ({placeholders})
                ORDER BY ship_key ASC, name COLLATE NOCASE ASC
                """,
                tuple(ship_keys),
            ) as cur:
                for r in await cur.fetchall():
                    commanders_by_key[r["ship_key"]].append(r["name"])

        def _simple_title_case(s: str) -> str:
            s = " ".join(s.split())
            if not s:
                return s
            return " ".join((w[:1].upper() + w[1:]) if w else w for w in s.split(" "))

        stats["popular_ship_names"] = [
            {
                "ship_name": _simple_title_case(r["ship_key"]),
                "commanders": r["commanders"],
                "cmdrs": commanders_by_key.get(r["ship_key"], []),
            }
            for r in rows
        ]

        # Biggest leader (largest gap between 1st and 2nd place, % sorted)
        async with db.execute(
            """
            WITH best_times AS (
                SELECT location, name, MIN(time) AS best
                FROM results
                GROUP BY location, name
            ),
            ranked AS (
                SELECT
                    location,
                    name,
                    best,
                    RANK() OVER (PARTITION BY location ORDER BY best ASC) AS rank
                FROM best_times
            ),
            participant_counts AS (
                SELECT location, COUNT(DISTINCT name) AS participants
                FROM best_times
                GROUP BY location
                HAVING COUNT(DISTINCT name) > 5
            ),
            first_second AS (
                SELECT
                    l.key,
                    l.name AS race_name,
                    l.type,
                    l.version,
                    l.tags,
                    r1.name AS commander,
                    r2.name AS second_commander,
                    r1.best AS first_time,
                    r2.best AS second_time,
                    r2.best - r1.best AS lead_ms,
                    ROUND(100.0 * (r2.best - r1.best) / r2.best, 1) AS lead_pct
                FROM ranked r1
                JOIN ranked r2 ON r1.location = r2.location
                    AND r1.rank = 1 AND r2.rank = 2
                JOIN locations l ON l.key = r1.location
                JOIN participant_counts pc ON pc.location = r1.location
            ),
            with_rank AS (
                SELECT *,
                    DENSE_RANK() OVER (ORDER BY lead_pct DESC) AS rnk
                FROM first_second
            )
            SELECT key, race_name, type, version, tags, commander, second_commander, first_time, second_time, lead_ms, lead_pct
            FROM with_rank
            WHERE rnk <= ?
            ORDER BY lead_pct DESC, race_name ASC
            """,
            (limit,),
        ) as cur:
            stats["biggest_leaders"] = [_row_to_dict(r) for r in await cur.fetchall()]

        # Closest finish (smallest gap between 1st and 2nd place, % sorted)
        async with db.execute(
            """
            WITH best_times AS (
                SELECT location, name, MIN(time) AS best
                FROM results
                GROUP BY location, name
            ),
            ranked AS (
                SELECT
                    location,
                    name,
                    best,
                    RANK() OVER (PARTITION BY location ORDER BY best ASC) AS rank
                FROM best_times
            ),
            participant_counts AS (
                SELECT location, COUNT(DISTINCT name) AS participants
                FROM best_times
                GROUP BY location
                HAVING COUNT(DISTINCT name) > 5
            ),
            first_second AS (
                SELECT
                    l.key,
                    l.name AS race_name,
                    l.type,
                    l.version,
                    l.tags,
                    r1.name AS commander,
                    r2.name AS second_commander,
                    r1.best AS first_time,
                    r2.best AS second_time,
                    r2.best - r1.best AS lead_ms,
                    ROUND(100.0 * (r2.best - r1.best) / r2.best, 2) AS lead_pct
                FROM ranked r1
                JOIN ranked r2 ON r1.location = r2.location
                    AND r1.rank = 1 AND r2.rank = 2
                JOIN locations l ON l.key = r1.location
                JOIN participant_counts pc ON pc.location = r1.location
            ),
            with_rank AS (
                SELECT *,
                    DENSE_RANK() OVER (ORDER BY lead_pct ASC) AS rnk
                FROM first_second
            )
            SELECT key, race_name, type, version, tags, commander, second_commander, first_time, second_time, lead_ms, lead_pct
            FROM with_rank
            WHERE rnk <= ?
            ORDER BY lead_pct ASC, race_name ASC
            """,
            (limit,),
        ) as cur:
            stats["closest_finishes"] = [_row_to_dict(r) for r in await cur.fetchall()]

        return stats
    finally:
        await db.close()
