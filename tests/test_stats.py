"""Regression checks for podium ship popularity using an isolated database."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.database import get_db
from app.main import app
from app.queries import get_stats_with_limit


class PodiumShipStatsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch("app.database.DB_PATH", Path(self.temp.name) / "test.sqlite3")
        self.db_patch.start()
        db = await get_db()
        try:
            await db.executescript("""
                CREATE TABLE locations (
                    key TEXT PRIMARY KEY, name TEXT DEFAULT '', type TEXT DEFAULT 'SHIP',
                    version TEXT DEFAULT '', system TEXT DEFAULT '', creator TEXT DEFAULT '',
                    tags TEXT DEFAULT '', multi_planet INTEGER DEFAULT 0,
                    multi_system INTEGER DEFAULT 0
                );
                CREATE TABLE results (
                    id INTEGER PRIMARY KEY, location TEXT, name TEXT, time INTEGER,
                    updated TEXT, ship TEXT DEFAULT '', shipname TEXT DEFAULT ''
                );
                INSERT INTO locations (key, type, multi_planet, multi_system) VALUES
                    ('local', 'SHIP', 0, 0), ('planet', 'SHIP', 1, 0),
                    ('system', 'SHIP', 0, 1), ('both', 'SHIP', 1, 1),
                    ('srv', 'SRV', 0, 0), ('fighter', 'FIGHTER', 0, 0),
                    ('foot', 'ONFOOT', 0, 0), ('invalid', 'SHIP', 0, 0),
                    ('empty', 'SHIP', 0, 0);
                INSERT INTO results (location, name, ship, time, updated) VALUES
                    ('local', 'A', 'Old ship', 50, '2026-01-01'),
                    ('local', 'A', 'Viper', 100, '2026-01-02'),
                    ('local', 'B', 'Eagle', 200, '2026-01-02'),
                    ('local', 'C', 'Eagle', 300, '2026-01-02'),
                    ('local', 'D', 'Old leader', 1, '2026-01-01'),
                    ('local', 'D', 'Not on podium', 400, '2026-01-02'),
                    ('planet', 'A', 'Cobra', 100, '2026-01-02'),
                    ('planet', 'B', 'Cobra', 200, '2026-01-02'),
                    ('system', 'A', 'Cobra', 100, '2026-01-02'),
                    ('both', 'A', 'Asp', 100, '2026-01-02'),
                    ('srv', 'A', 'Wrong vehicle race', 100, '2026-01-02'),
                    ('fighter', 'A', 'Wrong vehicle race', 100, '2026-01-02'),
                    ('foot', 'A', 'Wrong vehicle race', 100, '2026-01-02'),
                    ('invalid', 'A', '', 100, '2026-01-02'),
                    ('invalid', 'B', 'SRV', 200, '2026-01-02'),
                    ('invalid', 'C', 'On Foot', 300, '2026-01-02'),
                    ('invalid', 'D', 'Do not promote fourth', 400, '2026-01-02');
            """)
            await db.commit()
        finally:
            await db.close()

    async def asyncTearDown(self):
        self.db_patch.stop()
        self.temp.cleanup()

    async def test_current_top_three_and_disjoint_race_groups(self):
        stats = await get_stats_with_limit()
        self.assertEqual(
            stats["top_podium_ship_types"],
            [{"ship": "Eagle", "count": 2}, {"ship": "Viper", "count": 1}],
        )
        self.assertEqual(
            stats["top_podium_ship_types_multi"],
            [{"ship": "Cobra", "count": 3}, {"ship": "Asp", "count": 1}],
        )

    async def test_equal_times_select_exactly_three_by_commander_name(self):
        db = await get_db()
        try:
            await db.execute("DELETE FROM results")
            await db.executemany(
                "INSERT INTO results (location, name, ship, time, updated) "
                "VALUES ('local', ?, ?, 100, '2026-01-02')",
                [("D", "Fourth"), ("C", "Eagle"), ("B", "Cobra"), ("A", "Viper")],
            )
            await db.commit()
        finally:
            await db.close()
        stats = await get_stats_with_limit(limit=1)
        # All three types tie for most popular, so the top-N limit includes them all.
        self.assertEqual(
            stats["top_podium_ship_types"],
            [
                {"ship": "Cobra", "count": 1},
                {"ship": "Eagle", "count": 1},
                {"ship": "Viper", "count": 1},
            ],
        )
        self.assertEqual(stats["top_podium_ship_types_multi"], [])

    async def test_empty_results_return_both_empty_sets(self):
        db = await get_db()
        try:
            await db.execute("DELETE FROM results")
            await db.commit()
        finally:
            await db.close()
        stats = await get_stats_with_limit()
        self.assertEqual(stats["top_podium_ship_types"], [])
        self.assertEqual(stats["top_podium_ship_types_multi"], [])

    async def test_stats_api_applies_limit_independently_to_each_group(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/stats?limit=1")
            self.assertEqual(response.status_code, 200)
            stats = response.json()
            self.assertEqual(stats["top_podium_ship_types"], [{"ship": "Eagle", "count": 2}])
            self.assertEqual(stats["top_podium_ship_types_multi"], [{"ship": "Cobra", "count": 3}])
            default = await client.get("/api/stats")
            self.assertEqual(default.status_code, 200)
            self.assertEqual(len(default.json()["top_podium_ship_types"]), 2)
