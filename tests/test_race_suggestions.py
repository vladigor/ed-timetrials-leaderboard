"""Focused checks for the race picker's bulk data and page routes."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.database import get_db
from app.main import app
from app.queries import get_race, get_rivals, list_race_suggestions


class RaceSuggestionsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch("app.database.DB_PATH", Path(self.temp.name) / "test.sqlite3")
        self.db_patch.start()
        db = await get_db()
        try:
            await db.executescript("""
                CREATE TABLE locations (
                    key TEXT PRIMARY KEY, name TEXT DEFAULT '', description TEXT DEFAULT '',
                    type TEXT DEFAULT 'SRV', version TEXT DEFAULT 'ODYSSEY',
                    system TEXT DEFAULT '', station TEXT DEFAULT '', address TEXT DEFAULT '',
                    sort TEXT DEFAULT '', coords TEXT DEFAULT '', creator TEXT DEFAULT '',
                    created_at TEXT DEFAULT '', multi_mode INTEGER DEFAULT 0,
                    multi_planet INTEGER DEFAULT 0, multi_system INTEGER DEFAULT 0,
                    tags TEXT DEFAULT ''
                );
                CREATE TABLE results (
                    id INTEGER PRIMARY KEY, location TEXT, name TEXT, time INTEGER,
                    updated TEXT, ship TEXT DEFAULT '', shipname TEXT DEFAULT ''
                );
                CREATE TABLE constraints (location TEXT, key TEXT, value INTEGER);
                CREATE TABLE daylight_cache (race_key TEXT, state TEXT, until_utc TEXT);
                INSERT INTO locations (key, name) VALUES
                    ('odd', 'Odd'), ('even', 'Even'), ('empty', 'Empty');
                INSERT INTO results (location, name, time, updated) VALUES
                    ('odd', 'A', 100000, '2026-01-01'),
                    ('odd', 'A', 300000, '2026-01-02'),
                    ('odd', 'B', 200000, '2026-01-02'),
                    ('odd', 'C', 600000, '2026-01-02'),
                    ('even', 'A', 200000, '2026-01-02'),
                    ('even', 'B', 400000, '2026-01-02');
            """)
            await db.commit()
        finally:
            await db.close()

    async def asyncTearDown(self):
        self.db_patch.stop()
        self.temp.cleanup()

    async def test_median_counts_each_current_finisher_once(self):
        races = {race["key"]: race for race in await list_race_suggestions()}
        self.assertEqual(races["odd"]["median_time_ms"], 300000)
        self.assertEqual(races["even"]["median_time_ms"], 300000)
        self.assertIsNone(races["empty"]["median_time_ms"])
        self.assertEqual(races["empty"]["results"], [])
        self.assertEqual(
            races["odd"]["results"],
            [
                {"name": "B", "time_ms": 200000, "position": 1},
                {"name": "A", "time_ms": 300000, "position": 2},
                {"name": "C", "time_ms": 600000, "position": 3},
            ],
        )

    async def test_current_times_match_race_detail(self):
        # get_race also reads these tables for rivalry and record-holder data.
        db = await get_db()
        try:
            await db.executescript("""
                CREATE TABLE position_snapshots (
                    location TEXT, name TEXT, position INTEGER, time_ms INTEGER, snapped_at TEXT
                );
            """)
        finally:
            await db.close()
        summary = next(r for r in await list_race_suggestions() if r["key"] == "odd")
        detail = await get_race("odd")
        self.assertEqual(
            summary["results"],
            [
                {key: row[key] for key in ("name", "time_ms", "position")}
                for row in detail["results"]
            ],
        )

    async def test_rivals_compare_best_times_and_filter_remote_races(self):
        db = await get_db()
        try:
            await db.execute(
                "UPDATE locations SET type = 'SRV', tags = 'Circuit' WHERE key = 'odd'"
            )
            await db.execute(
                "UPDATE locations SET type = 'SHIP', multi_mode = 1, tags = 'Remote' WHERE key = 'even'"
            )
            await db.execute("UPDATE locations SET type = 'ONFOOT' WHERE key = 'empty'")
            await db.execute(
                "INSERT INTO locations (key, name, type, tags) VALUES ('dw3-race', 'DW3 Race', 'SHIP', 'DW3')"
            )
            await db.execute(
                "INSERT INTO locations (key, name, type, tags) VALUES ('circuit-extra', 'Circuit Extra', 'SRV', 'Circuit')"
            )
            await db.executemany(
                "INSERT INTO locations (key, name, type, tags) VALUES (?, ?, 'SRV', 'Circuit')",
                [
                    ("circuit-third", "Circuit Third"),
                    ("circuit-fourth", "Circuit Fourth"),
                    ("circuit-fifth", "Circuit Fifth"),
                ],
            )
            await db.execute(
                "INSERT INTO locations (key, name, type) VALUES ('solo-race', 'Solo Race', 'SRV')"
            )
            await db.executemany(
                "INSERT INTO results (location, name, time, updated) VALUES (?, ?, ?, ?)",
                [
                    ("odd", "B", 50000, "2026-01-03"),
                    ("odd", "C", 70000, "2026-01-03"),
                    ("odd", "D", 150000, "2026-01-03"),
                    ("odd", "G", 50000, "2026-01-03"),
                    ("odd", "H", 50000, "2026-01-03"),
                    ("odd", "I", 50000, "2026-01-03"),
                    ("even", "B", 100000, "2026-01-03"),
                    ("dw3-race", "A", 200000, "2026-01-03"),
                    ("dw3-race", "B", 100000, "2026-01-03"),
                    ("empty", "A", 500000, "2026-01-03"),
                    ("empty", "D", 400000, "2026-01-03"),
                    ("circuit-extra", "A", 100000, "2026-01-03"),
                    ("circuit-extra", "B", 150000, "2026-01-03"),
                    ("circuit-extra", "C", 50000, "2026-01-03"),
                    ("circuit-extra", "D", 50000, "2026-01-03"),
                    ("circuit-extra", "E", 75000, "2026-01-03"),
                    ("circuit-extra", "F", 100000, "2026-01-03"),
                    ("circuit-extra", "G", 50000, "2026-01-03"),
                    ("circuit-extra", "H", 150000, "2026-01-03"),
                    ("circuit-extra", "I", 150000, "2026-01-03"),
                    ("circuit-third", "A", 100000, "2026-01-03"),
                    ("circuit-third", "B", 50000, "2026-01-03"),
                    ("circuit-third", "C", 150000, "2026-01-03"),
                    ("circuit-third", "D", 200000, "2026-01-03"),
                    ("circuit-third", "G", 50000, "2026-01-03"),
                    ("circuit-third", "H", 50000, "2026-01-03"),
                    ("circuit-fourth", "A", 100000, "2026-01-03"),
                    ("circuit-fourth", "H", 150000, "2026-01-03"),
                    ("circuit-fifth", "A", 100000, "2026-01-03"),
                    ("circuit-fifth", "H", 50000, "2026-01-03"),
                    ("solo-race", "A", 100000, "2026-01-03"),
                ],
            )
            await db.commit()
        finally:
            await db.close()

        all_categories = {item["key"]: item for item in await get_rivals("A")}
        all_rivals = {key: item["rivals"] for key, item in all_categories.items()}
        circuit_rivals = all_rivals["srv_circuit"]
        self.assertEqual(all_categories["srv_circuit"]["races_competed"], 5)
        self.assertEqual(all_categories["srv_circuit"]["ahead_percentage"], 33)
        self.assertEqual(
            [rival["commander"] for rival in circuit_rivals],
            ["H", "D", "B", "C", "G"],
        )
        self.assertEqual(circuit_rivals[0]["ahead_count"], 3)
        self.assertEqual(circuit_rivals[0]["behind_count"], 2)
        self.assertEqual(circuit_rivals[1]["ahead_count"], 1)
        self.assertEqual(circuit_rivals[1]["behind_count"], 2)
        self.assertNotIn("E", [rival["commander"] for rival in circuit_rivals])
        self.assertNotIn("I", [rival["commander"] for rival in circuit_rivals])
        self.assertEqual(all_categories["srv_non_circuit"]["races_competed"], 1)
        self.assertEqual(all_categories["srv_non_circuit"]["ahead_percentage"], 0)
        self.assertEqual(all_rivals["ship_buckyball"], [])
        self.assertEqual(all_rivals["ship_canyon"], [])
        self.assertEqual(all_rivals["on_foot"], [])

        bubble_categories = {item["key"]: item for item in await get_rivals("A", bubble_only=True)}
        bubble_rivals = {key: item["rivals"] for key, item in bubble_categories.items()}
        self.assertEqual(bubble_rivals["ship_buckyball"], [])
        self.assertEqual(bubble_rivals["ship_canyon"], [])
        self.assertEqual(bubble_rivals["srv_circuit"][0]["commander"], "H")
        self.assertEqual(bubble_categories["ship_canyon"]["races_competed"], 0)

    async def test_page_and_api_routes(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            page = await client.get("/today")
            self.assertEqual(page.status_code, 200)
            self.assertIn("Where do you want to race today?", page.text)
            self.assertIn('src="/static/js/today.js?v=', page.text)
            self.assertIn('id="filter-search"', page.text)
            self.assertIn('id="filter-hide-dw3"', page.text)
            self.assertIn('id="filter-hide-horizons"', page.text)
            self.assertNotIn('id="filter-daytime-only"', page.text)
            self.assertIn('value="catchability"', page.text)
            rivals_page = await client.get("/rivals")
            self.assertEqual(rivals_page.status_code, 200)
            self.assertIn('id="filter-bubble-only" type="checkbox" checked', rivals_page.text)
            self.assertIn('src="/static/js/rivals.js?v=', rivals_page.text)
            index = await client.get("/")
            self.assertIn('id="filter-daytime-only"', index.text)
            self.assertNotIn('value="catchability"', index.text)
            response = await client.get("/api/race-suggestions")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()), 3)
            self.assertIn("median_time_ms", response.json()[0])

    async def test_powerplay_respects_commander_feature_gate(self):
        db = await get_db()
        try:
            await db.execute("UPDATE locations SET system = 'Sol' WHERE key = 'odd'")
            await db.commit()
        finally:
            await db.close()
        with (
            patch("app.main.POWERPLAY_ENABLED", False),
            patch("app.main.POWERPLAY_ENABLED_FOR", {"tester"}),
            patch("app.main.POWERPLAY_SYSTEMS", {"sol": "Test Power"}),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                enabled = await client.get("/api/race-suggestions?commander=Tester")
                odd = next(r for r in enabled.json() if r["key"] == "odd")
                self.assertEqual(odd["powerplay"], "Test Power")
                disabled = await client.get("/api/race-suggestions?commander=Other")
                self.assertTrue(all("powerplay" not in r for r in disabled.json()))

    async def test_feature_gated_filter_controls(self):
        with (
            patch("app.main.FAVOURITES_ENABLED", False),
            patch("app.main.FAVOURITES_ENABLED_FOR", {"tester"}),
            patch("app.main.POWERPLAY_ENABLED", False),
            patch("app.main.POWERPLAY_ENABLED_FOR", {"tester"}),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                page = await client.get("/today")
                self.assertEqual(page.status_code, 200)
                self.assertIn('id="filter-hide-ignored"', page.text)
                self.assertIn('id="filter-powerplay-only"', page.text)
                self.assertIn('value="favourites"', page.text)
                self.assertIn('favourites_for: ["tester"]', page.text)
                self.assertIn('powerplay_for: ["tester"]', page.text)
                self.assertNotIn('id="filter-daytime-only"', page.text)
