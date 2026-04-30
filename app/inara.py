"""Inara API client with caching support."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import TypedDict

import httpx

from .config import (
    INARA_API_KEY,
    INARA_APP_NAME,
    INARA_APP_VERSION,
    INARA_CACHE_DURATION_DAYS,
    OFFLINE,
)
from .database import get_db

log = logging.getLogger(__name__)

INARA_API_URL = "https://inara.cz/inapi/v1/"


class InaraProfile(TypedDict):
    """Commander profile data from Inara."""

    avatar_url: str
    inara_url: str


async def get_commander_profile(
    commander_name: str, force_refresh: bool = False
) -> InaraProfile | None:
    """
    Fetch commander profile from Inara API with caching.

    Args:
        commander_name: Commander name to look up
        force_refresh: If True, bypass cache and fetch fresh data from API

    Returns None if:
    - OFFLINE mode is enabled
    - No API key is configured
    - Commander not found on Inara
    - API request fails
    """
    if OFFLINE or not INARA_API_KEY:
        log.debug("Inara API disabled (OFFLINE=%s, API_KEY=%s)", OFFLINE, bool(INARA_API_KEY))
        return None

    # Check cache first (unless force_refresh is set)
    if not force_refresh:
        cached = await _get_cached_profile(commander_name)
        if cached:
            log.debug("Inara profile cache hit for %r", commander_name)
            return cached

    # Fetch from API
    log.info("Fetching Inara profile for %r (force_refresh=%s)", commander_name, force_refresh)
    profile = await _fetch_from_api(commander_name)
    if profile:
        await _cache_profile(commander_name, profile)
    return profile


async def _get_cached_profile(commander_name: str) -> InaraProfile | None:
    """Retrieve cached profile if it exists and is not expired."""
    db = await get_db()
    try:
        async with db.execute(
            """
            SELECT avatar_url, inara_url, cached_at
            FROM inara_cache
            WHERE commander_name = ? COLLATE NOCASE
            """,
            (commander_name,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return None

        cached_at = datetime.fromisoformat(row[2])
        expiry = cached_at + timedelta(days=INARA_CACHE_DURATION_DAYS)
        if datetime.now(timezone.utc) > expiry:
            log.debug("Inara cache expired for %r", commander_name)
            return None

        return {"avatar_url": row[0], "inara_url": row[1]}
    finally:
        await db.close()


async def _cache_profile(commander_name: str, profile: InaraProfile) -> None:
    """Store profile in cache."""
    db = await get_db()
    try:
        await db.execute(
            """
            INSERT INTO inara_cache (commander_name, avatar_url, inara_url, cached_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(commander_name) DO UPDATE SET
                avatar_url = excluded.avatar_url,
                inara_url = excluded.inara_url,
                cached_at = excluded.cached_at
            """,
            (
                commander_name,
                profile["avatar_url"],
                profile["inara_url"],
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        await db.commit()
    finally:
        await db.close()


async def _fetch_from_api(commander_name: str) -> InaraProfile | None:
    """Query Inara API for commander profile."""
    payload = {
        "header": {
            "appName": INARA_APP_NAME,
            "appVersion": INARA_APP_VERSION,
            "APIkey": INARA_API_KEY,
        },
        "events": [
            {
                "eventName": "getCommanderProfile",
                "eventTimestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "eventData": {"searchName": commander_name},
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(INARA_API_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        log.warning("Inara API request failed for %r: %s", commander_name, exc)
        return None

    # Debug: log the full response
    log.info("Inara API response for %r: %s", commander_name, data)

    # Check response structure
    if not data or "events" not in data or not data["events"]:
        log.warning("Inara API returned empty events for %r", commander_name)
        return None

    event = data["events"][0]
    status = event.get("eventStatus")

    # eventStatus 200 = OK, 204 = no data found
    if status != 200:
        log.info("Inara API returned status %s for %r", status, commander_name)
        return None

    event_data = event.get("eventData", {})
    avatar_url = event_data.get("avatarImageURL", "")
    inara_url = event_data.get("inaraURL", "")

    if not avatar_url or not inara_url:
        log.warning(
            "Inara profile missing avatar or URL for %r (avatar=%s, url=%s)",
            commander_name,
            avatar_url,
            inara_url,
        )
        return None

    return {"avatar_url": avatar_url, "inara_url": inara_url}


async def invalidate_cache(commander_name: str) -> None:
    """Remove cached profile for a commander, forcing next fetch to be fresh."""
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM inara_cache WHERE commander_name = ? COLLATE NOCASE",
            (commander_name,),
        )
        await db.commit()
        log.info("Invalidated Inara cache for %r", commander_name)
    finally:
        await db.close()
