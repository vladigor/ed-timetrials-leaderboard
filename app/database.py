"""SQLite database initialisation and helper functions."""

import contextlib
from pathlib import Path

import aiosqlite

DB_PATH = Path(__file__).parent.parent / "leaderboard.sqlite3"

_CREATE_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS last_updated_cache (
    key     TEXT PRIMARY KEY,
    updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inara_cache (
    commander_name  TEXT PRIMARY KEY COLLATE NOCASE,
    avatar_url      TEXT NOT NULL,
    inara_url       TEXT NOT NULL,
    cached_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
    key         TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL DEFAULT '',
    version     TEXT NOT NULL DEFAULT '',
    system      TEXT NOT NULL DEFAULT '',
    station     TEXT NOT NULL DEFAULT '',
    address     TEXT NOT NULL DEFAULT '',
    sort        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS constraints (
    location    TEXT REFERENCES locations(key) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       INTEGER NOT NULL,
    PRIMARY KEY (location, key)
);

CREATE TABLE IF NOT EXISTS results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    ship        TEXT NOT NULL DEFAULT '',
    shipname    TEXT NOT NULL DEFAULT '',
    location    TEXT REFERENCES locations(key) ON DELETE CASCADE,
    time        INTEGER NOT NULL,
    updated     TEXT NOT NULL,
    UNIQUE (name, location, updated) ON CONFLICT IGNORE
);

CREATE TABLE IF NOT EXISTS results_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    ship        TEXT NOT NULL DEFAULT '',
    shipname    TEXT NOT NULL DEFAULT '',
    location    TEXT REFERENCES locations(key) ON DELETE CASCADE,
    time        INTEGER NOT NULL,
    updated     TEXT NOT NULL,
    position    INTEGER,
    UNIQUE (name, location, updated) ON CONFLICT IGNORE
);
CREATE INDEX IF NOT EXISTS idx_history_name ON results_history(name);
CREATE INDEX IF NOT EXISTS idx_history_location ON results_history(location);
CREATE INDEX IF NOT EXISTS idx_history_updated ON results_history(updated);
CREATE INDEX IF NOT EXISTS idx_history_name_location ON results_history(name, location);

CREATE TABLE IF NOT EXISTS position_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    location    TEXT NOT NULL,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL,
    time_ms     INTEGER NOT NULL,
    snapped_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_loc_name ON position_snapshots(location, name);
CREATE INDEX IF NOT EXISTS idx_snapshots_snapped_at ON position_snapshots(snapped_at);
"""


async def get_db() -> aiosqlite.Connection:
    """Open a database connection with row_factory set to Row."""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys=ON")
    await db.execute("PRAGMA journal_mode=WAL")
    return db


async def init_db() -> None:
    """Create tables if they do not already exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.executescript(_CREATE_SQL)
        # Migrations – add race-detail columns if they don't already exist
        for col_sql in (
            "ALTER TABLE locations ADD COLUMN description TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE locations ADD COLUMN num_checkpoints INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE locations ADD COLUMN multi_planet BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE locations ADD COLUMN multi_system BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE locations ADD COLUMN multi_vessel BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE locations ADD COLUMN multi_mode BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE locations ADD COLUMN coords TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE locations ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE locations ADD COLUMN creator TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE results_history ADD COLUMN position INTEGER",
        ):
            with contextlib.suppress(Exception):
                await db.execute(col_sql)
        # One-time migration: multi_vessel was previously derived from getTTList row[14]
        # (which flags circuit races, not multi-mode races). Reset num_checkpoints so
        # fetch_and_store_race_details re-fetches waypoints and recalculates correctly.
        async with db.execute(
            "SELECT key FROM last_updated_cache WHERE key = 'migration_multi_vessel_v1'"
        ) as cur:
            already_done = await cur.fetchone()
        if not already_done:
            await db.execute("UPDATE locations SET num_checkpoints = 0")
            await db.execute(
                "INSERT INTO last_updated_cache (key, updated) VALUES ('migration_multi_vessel_v1', 'done')"
            )
        # One-time migration: renamed multi_vessel → multi_mode; force re-fetch to populate new column.
        async with db.execute(
            "SELECT key FROM last_updated_cache WHERE key = 'migration_multi_mode_v1'"
        ) as cur:
            already_done2 = await cur.fetchone()
        if not already_done2:
            await db.execute("UPDATE locations SET num_checkpoints = 0")
            await db.execute(
                "INSERT INTO last_updated_cache (key, updated) VALUES ('migration_multi_mode_v1', 'done')"
            )
        # One-time migration: remove superseded races (name contains SUPERSEDED or DO NOT USE)
        async with db.execute(
            "SELECT key FROM last_updated_cache WHERE key = 'migration_superseded_v1'"
        ) as cur:
            already_done3 = await cur.fetchone()
        if not already_done3:
            await db.execute(
                "DELETE FROM locations WHERE lower(name) LIKE '%superseded%' OR lower(name) LIKE '%do not use%'"
            )
            await db.execute(
                "INSERT INTO last_updated_cache (key, updated) VALUES ('migration_superseded_v1', 'done')"
            )
        # One-time migration: populate results_history with existing results data
        async with db.execute(
            "SELECT key FROM last_updated_cache WHERE key = 'migration_results_history_v1'"
        ) as cur:
            already_done4 = await cur.fetchone()
        if not already_done4:
            # Copy all existing results to results_history
            await db.execute(
                """
                INSERT OR IGNORE INTO results_history (name, ship, shipname, location, time, updated)
                SELECT name, ship, shipname, location, time, updated FROM results
                """
            )
            await db.execute(
                "INSERT INTO last_updated_cache (key, updated) VALUES ('migration_results_history_v1', 'done')"
            )
        # One-time migration: backfill positions in results_history
        async with db.execute(
            "SELECT key FROM last_updated_cache WHERE key = 'migration_history_positions_v1'"
        ) as cur:
            already_done5 = await cur.fetchone()
        if not already_done5:
            # Backfill positions for all existing history records
            # For each record, calculate position based on best times at that point in time
            async with db.execute(
                """
                SELECT DISTINCT location FROM results_history ORDER BY location
                """
            ) as cur:
                locations = [row["location"] async for row in cur]

            for loc in locations:
                # Process each location separately
                async with db.execute(
                    """
                    SELECT id, name, time, updated
                    FROM results_history
                    WHERE location = ?
                    ORDER BY updated ASC
                    """,
                    (loc,),
                ) as cur:
                    history_records = [dict(row) async for row in cur]

                # Track best time for each commander up to each point
                best_times = {}  # {name: time}

                for record in history_records:
                    cmdr = record["name"]
                    time_ms = record["time"]

                    # Update this commander's best time if this is better
                    if cmdr not in best_times or time_ms < best_times[cmdr]:
                        best_times[cmdr] = time_ms

                    # Calculate position based on current best_times
                    sorted_commanders = sorted(best_times.items(), key=lambda x: x[1])
                    position = next(
                        i + 1 for i, (name, _) in enumerate(sorted_commanders) if name == cmdr
                    )

                    # Update the history record with the position
                    await db.execute(
                        "UPDATE results_history SET position = ? WHERE id = ?",
                        (position, record["id"]),
                    )

            await db.execute(
                "INSERT INTO last_updated_cache (key, updated) VALUES ('migration_history_positions_v1', 'done')"
            )
        # Purge snapshots older than 90 days on each startup to keep DB lean
        await db.execute(
            "DELETE FROM position_snapshots WHERE snapped_at < datetime('now', '-90 days')"
        )
        await db.commit()
