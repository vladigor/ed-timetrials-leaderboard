import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.main import _parse_alpha_time_trials, app


class AlphaTimeTrialTests(unittest.IsolatedAsyncioTestCase):
    async def test_parser_keeps_only_alpha_races(self):
        rows = [
            ["alpha-key", "Alpha Race", "System", "Station", "", "SRV", "", "ODY", "", "ALPHA"],
            ["prod-key", "Production Race", "System", "", "", "SHIP", "", "HRZ", "", "PROD"],
            ["author-key", "Author Race", "System", "", "", "SHIP", "", "ODY", "", "AUTHOR"],
        ]

        self.assertEqual(
            _parse_alpha_time_trials(rows),
            [
                {
                    "key": "alpha-key",
                    "creator": "alpha",
                    "name": "Alpha Race",
                    "system": "System",
                    "station": "Station",
                    "type": "SRV",
                    "version": "ODYSSEY",
                }
            ],
        )

    async def test_parser_rejects_malformed_rows(self):
        with self.assertRaises(ValueError):
            _parse_alpha_time_trials([["too", "short"]])

    async def test_api_requires_enabled_flag_or_allowed_commander(self):
        with (
            patch("app.main.ALPHA_TIME_TRIALS_ENABLED", False),
            patch("app.main.ALPHA_TIME_TRIALS_ENABLED_FOR", {"vladigor"}),
            patch("app.main.OFFLINE", False),
            patch(
                "app.main._fetch_alpha_time_trials",
                new_callable=AsyncMock,
                return_value=[],
            ) as fetch,
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                denied = await client.get("/api/alpha-time-trials?commander=other")
                allowed = await client.get("/api/alpha-time-trials?commander=VLADIGOR")

        self.assertEqual(denied.status_code, 403)
        self.assertEqual(allowed.status_code, 200)
        fetch.assert_awaited_once_with("VLADIGOR")

    async def test_api_fetches_alpha_races_when_globally_enabled(self):
        races = [{"key": "alpha-key", "name": "Alpha Race"}]
        with (
            patch("app.main.ALPHA_TIME_TRIALS_ENABLED", True),
            patch("app.main.ALPHA_TIME_TRIALS_ENABLED_FOR", set()),
            patch("app.main.OFFLINE", False),
            patch(
                "app.main._fetch_alpha_time_trials", new_callable=AsyncMock, return_value=races
            ) as fetch,
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get("/api/alpha-time-trials?commander=Test%20Pilot")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), races)
        fetch.assert_awaited_once_with("Test Pilot")

    async def test_page_is_hidden_when_feature_is_disabled(self):
        with (
            patch("app.main.ALPHA_TIME_TRIALS_ENABLED", False),
            patch("app.main.ALPHA_TIME_TRIALS_ENABLED_FOR", set()),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get("/alphas")

        self.assertEqual(response.status_code, 404)
