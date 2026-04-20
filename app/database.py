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
        # Purge snapshots older than 90 days on each startup to keep DB lean
        await db.execute(
            "DELETE FROM position_snapshots WHERE snapped_at < datetime('now', '-90 days')"
        )
        await db.commit()
