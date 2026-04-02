"""SQLite database initialisation and helper functions."""

import aiosqlite
from pathlib import Path

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
        await db.commit()
