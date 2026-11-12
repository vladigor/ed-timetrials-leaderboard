"""Regression checks for non-blocking startup and background refresh cleanup."""

import asyncio
import re
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import httpx

from app.database import get_db
from app.main import app, lifespan
from app.scheduler import full_refresh


class StartupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        patches = ExitStack()
        self.addCleanup(patches.close)
        self.init_db = patches.enter_context(patch("app.main.init_db", new_callable=AsyncMock))
        self.refresh = patches.enter_context(patch("app.main.full_refresh", new_callable=AsyncMock))
        self.scheduler = Mock()
        self.start_scheduler = patches.enter_context(
            patch("app.main.start_scheduler", return_value=self.scheduler)
        )
        patches.enter_context(patch("app.main.OFFLINE", False))

    async def test_security_headers_include_a_nonce_based_csp(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/")

        self.assertEqual(response.status_code, 200)
        policy = response.headers["content-security-policy"]
        inline_scripts = re.findall(r"<script\b(?![^>]*\bsrc=)[^>]*>", response.text)
        self.assertTrue(inline_scripts)
        nonce = re.search(r'\bnonce="([^"]+)"', inline_scripts[0]).group(1)
        self.assertTrue(all(f'nonce="{nonce}"' in tag for tag in inline_scripts))
        self.assertIn(f"'nonce-{nonce}'", policy)
        self.assertIn("object-src 'none'", policy)
        self.assertIn("frame-ancestors 'self'", policy)

    async def test_slow_refresh_does_not_delay_serving_and_is_cancelled_on_shutdown(self):
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def slow_refresh():
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        self.refresh.side_effect = slow_refresh

        async def exercise_lifespan():
            async with lifespan(app):
                self.init_db.assert_awaited_once()
                await started.wait()
                self.start_scheduler.assert_not_called()
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                ) as client:
                    response = await client.get("/")
                self.assertEqual(response.status_code, 200)
                self.assertFalse(cancelled.is_set())

        await asyncio.wait_for(exercise_lifespan(), timeout=1)
        self.assertTrue(cancelled.is_set())
        self.start_scheduler.assert_not_called()

    async def test_cached_daynight_data_is_available_while_upstream_refresh_is_pending(self):
        started = asyncio.Event()

        async def slow_daynight_fetch():
            started.set()
            await asyncio.Event().wait()

        with tempfile.TemporaryDirectory() as temp, ExitStack() as patches:
            patches.enter_context(patch("app.database.DB_PATH", Path(temp) / "test.sqlite3"))
            for name in (
                "fetch_and_store_locations",
                "fetch_and_store_race_details",
                "fetch_and_store_system_coords",
                "_save_cache",
            ):
                patches.enter_context(patch(f"app.scheduler.{name}", new_callable=AsyncMock))
            patches.enter_context(
                patch("app.scheduler.fetch_last_updated", AsyncMock(return_value={}))
            )
            patches.enter_context(patch("app.scheduler._load_cache", AsyncMock(return_value={})))
            patches.enter_context(
                patch(
                    "app.scheduler.fetch_and_store_daynight_bulk", side_effect=slow_daynight_fetch
                )
            )
            self.refresh.side_effect = full_refresh
            db = await get_db()
            try:
                await db.executescript("""
                    CREATE TABLE daynight_bulk_cache (
                        race_key TEXT PRIMARY KEY, state TEXT, until_utc TEXT,
                        upcoming_intervals TEXT, fetched_at TEXT
                    );
                    INSERT INTO daynight_bulk_cache VALUES
                        ('test-race', 'day', NULL, '[]', '2020-01-01T00:00:00Z');
                """)
                await db.commit()
            finally:
                await db.close()

            async def exercise_lifespan():
                async with lifespan(app):
                    await started.wait()
                    async with httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=app), base_url="http://test"
                    ) as client:
                        response = await client.get("/api/daynight-bulk")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(
                        response.json(),
                        {
                            "test-race": {
                                "state": "day",
                                "until": None,
                                "upcoming_intervals": [],
                                "fetched_at": "2020-01-01T00:00:00Z",
                            }
                        },
                    )
                    self.start_scheduler.assert_not_called()

            await asyncio.wait_for(exercise_lifespan(), timeout=1)

    async def test_scheduler_starts_after_refresh_and_stops_on_shutdown(self):
        scheduled = asyncio.Event()

        def start_scheduler():
            self.refresh.assert_awaited_once()
            scheduled.set()
            return self.scheduler

        self.start_scheduler.side_effect = start_scheduler
        async with lifespan(app):
            await asyncio.wait_for(scheduled.wait(), timeout=1)
            self.scheduler.shutdown.assert_not_called()
        self.scheduler.shutdown.assert_called_once_with(wait=False)

    async def test_unexpected_refresh_error_is_logged_and_polling_still_starts(self):
        self.refresh.side_effect = RuntimeError("upstream unavailable")
        scheduled = asyncio.Event()

        def start_scheduler():
            scheduled.set()
            return self.scheduler

        self.start_scheduler.side_effect = start_scheduler

        with self.assertLogs("app.main", level="ERROR") as logs:
            async with lifespan(app):
                await asyncio.wait_for(scheduled.wait(), timeout=1)
        self.assertIn("upstream unavailable", "\n".join(logs.output))
        self.scheduler.shutdown.assert_called_once_with(wait=False)

    async def test_offline_startup_does_not_refresh_or_start_scheduler(self):
        with patch("app.main.OFFLINE", True):
            async with lifespan(app):
                self.init_db.assert_awaited_once()
        self.refresh.assert_not_awaited()
        self.start_scheduler.assert_not_called()

    async def test_database_initialization_failure_still_prevents_startup(self):
        self.init_db.side_effect = RuntimeError("database unavailable")
        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            async with lifespan(app):
                self.fail("Startup must not succeed without database initialization")
        self.refresh.assert_not_awaited()
        self.start_scheduler.assert_not_called()
