"""FastAPI application entry point."""

from __future__ import annotations

import json
import logging
import mimetypes
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

import markdown
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import (
    DAYLIGHT_API_BASE_URL,
    DAYLIGHT_API_ENABLED,
    DAYLIGHT_API_ENABLED_FOR,
    DAYLIGHT_API_TIMEOUT,
    DAYLIGHT_CACHE_TTL,
    ENV,
    FAVOURITES_ENABLED,
    OFFLINE,
)
from .database import init_db
from .queries import (
    get_commander_stats,
    get_creator_races,
    get_race,
    get_race_meta,
    get_stats,
    get_stats_with_limit,
    list_commanders,
    list_creators,
    list_new_races,
    list_races,
)
from .scheduler import (
    full_refresh,
    get_last_updated_snapshot,
    get_poll_debug_status,
    start_scheduler,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent.parent / "static"
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
STATIC_VER = datetime.now().strftime("%Y%m%d-%H%M%S")

# Register WebP MIME type if not already known
if not mimetypes.guess_type("test.webp")[0]:
    mimetypes.add_type("image/webp", ".webp")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if OFFLINE:
        log.warning("OFFLINE MODE — all API calls disabled. Serving from local database only.")
    else:
        await full_refresh()
        start_scheduler()
    yield


app = FastAPI(title="Elite Dangerous Time Trials Leaderboard", lifespan=lifespan)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Add security headers for PWA compatibility and modern web standards."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/maps", StaticFiles(directory=Path(__file__).parent.parent / "maps"), name="maps")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


# ---------------------------------------------------------------------------
# HTML pages
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "v": STATIC_VER, "favourites_enabled": FAVOURITES_ENABLED},
    )


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico", media_type="image/x-icon")


@app.get("/site.webmanifest")
async def webmanifest():
    return FileResponse(STATIC_DIR / "site.webmanifest", media_type="application/manifest+json")


@app.get("/race/{key}", response_class=HTMLResponse)
async def race_page(request: Request, key: str):
    meta = await get_race_meta(key)
    race_name = meta["name"] if meta else key
    race_description = meta["description"] if meta else ""
    return templates.TemplateResponse(
        "race.html",
        {
            "request": request,
            "v": STATIC_VER,
            "is_dev": ENV == "dev",
            "favourites_enabled": FAVOURITES_ENABLED,
            "race_name": race_name,
            "race_description": race_description,
        },
    )


@app.get("/cmdr/{name}", response_class=HTMLResponse)
async def cmdr_page(request: Request, name: str):
    return templates.TemplateResponse(
        "cmdr.html", {"request": request, "v": STATIC_VER, "favourites_enabled": FAVOURITES_ENABLED}
    )


@app.get("/creator/{name}", response_class=HTMLResponse)
async def creator_page(request: Request, name: str):
    return templates.TemplateResponse("creator.html", {"request": request, "v": STATIC_VER})


@app.get("/creators", response_class=HTMLResponse)
async def creators_page(request: Request):
    return templates.TemplateResponse("creators.html", {"request": request, "v": STATIC_VER})


@app.get("/about", response_class=HTMLResponse)
async def about_page(request: Request):
    return templates.TemplateResponse("about.html", {"request": request, "v": STATIC_VER})


@app.get("/stats", response_class=HTMLResponse)
async def stats_page(request: Request):
    return templates.TemplateResponse("stats.html", {"request": request, "v": STATIC_VER})


@app.get("/challenges", response_class=HTMLResponse)
async def challenges_page(request: Request):
    return templates.TemplateResponse("challenges.html", {"request": request, "v": STATIC_VER})


@app.get("/activity", response_class=HTMLResponse)
async def activity_page(request: Request):
    return templates.TemplateResponse("activity.html", {"request": request, "v": STATIC_VER})


@app.get("/active-racers", response_class=HTMLResponse)
async def active_racers_page(request: Request):
    return templates.TemplateResponse("active-racers.html", {"request": request, "v": STATIC_VER})


@app.get("/thefts", response_class=HTMLResponse)
async def thefts_page(request: Request):
    return templates.TemplateResponse("thefts.html", {"request": request, "v": STATIC_VER})


@app.get("/races-list", response_class=HTMLResponse)
async def races_table_page(request: Request):
    return templates.TemplateResponse("races-table.html", {"request": request, "v": STATIC_VER})


@app.get("/guide", response_class=HTMLResponse)
async def guide_page(request: Request):
    """Render the racing beginners guide from markdown."""
    guide_path = Path(__file__).parent.parent / "documentation" / "guide.md"
    guide_content = guide_path.read_text(encoding="utf-8")

    # Configure markdown with extensions
    md = markdown.Markdown(extensions=["tables", "fenced_code", "nl2br"])
    html_content = md.convert(guide_content)

    return templates.TemplateResponse(
        "guide.html", {"request": request, "v": STATIC_VER, "content": html_content}
    )


@app.get("/graphics-settings", response_class=HTMLResponse)
async def graphics_settings_page(request: Request):
    """Render the graphics settings guide from markdown."""
    settings_path = (
        Path(__file__).parent.parent / "documentation" / "suggested_graphics_settings.md"
    )
    settings_content = settings_path.read_text(encoding="utf-8")

    # Configure markdown with extensions
    md = markdown.Markdown(extensions=["tables", "fenced_code", "nl2br"])
    html_content = md.convert(settings_content)

    return templates.TemplateResponse(
        "graphics-settings.html", {"request": request, "v": STATIC_VER, "content": html_content}
    )


@app.get("/about-me", response_class=HTMLResponse)
async def about_me_page(request: Request):
    """Render the about me page from markdown."""
    about_me_path = Path(__file__).parent.parent / "documentation" / "about-me.md"
    about_me_content = about_me_path.read_text(encoding="utf-8")

    # Configure markdown with extensions
    md = markdown.Markdown(extensions=["tables", "fenced_code", "nl2br"])
    html_content = md.convert(about_me_content)

    return templates.TemplateResponse(
        "about-me.html", {"request": request, "v": STATIC_VER, "content": html_content}
    )


@app.get("/changelog", response_class=HTMLResponse)
async def changelog_page(request: Request):
    """Render the changelog page from markdown."""
    changelog_path = Path(__file__).parent.parent / "CHANGELOG.md"
    changelog_content = changelog_path.read_text(encoding="utf-8")

    # Configure markdown with extensions
    md = markdown.Markdown(extensions=["tables", "fenced_code", "nl2br"])
    html_content = md.convert(changelog_content)

    return templates.TemplateResponse(
        "changelog.html", {"request": request, "v": STATIC_VER, "content": html_content}
    )


@app.get("/dw3-thanks", response_class=HTMLResponse)
async def dw3_thanks_page(request: Request):
    """Render the DW3 thanks page from markdown."""
    dw3_thanks_path = Path(__file__).parent.parent / "documentation" / "dw3-thanks.md"
    dw3_thanks_content = dw3_thanks_path.read_text(encoding="utf-8")

    # Configure markdown with extensions
    md = markdown.Markdown(extensions=["tables", "fenced_code", "nl2br"])
    html_content = md.convert(dw3_thanks_content)

    return templates.TemplateResponse(
        "dw3-thanks.html", {"request": request, "v": STATIC_VER, "content": html_content}
    )


@app.get("/community", response_class=HTMLResponse)
async def community_page(request: Request):
    """Render the racing community page."""
    return templates.TemplateResponse("community.html", {"request": request, "v": STATIC_VER})


@app.get("/race/{key}/add-media", response_class=HTMLResponse)
async def add_media_page(request: Request, key: str):
    """Render the add media form for a race (dev mode only)."""
    if ENV != "dev":
        raise HTTPException(status_code=403, detail="Add media form only available in dev mode")

    # Verify race exists
    race = await get_race(key)
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")

    # Load existing media data for this race
    media_file = Path(__file__).parent.parent / "media.json"
    existing_media = {}
    if media_file.exists():
        try:
            with open(media_file) as f:
                media_data = json.load(f)
            existing_media = media_data.get(key, {})
        except Exception as exc:
            log.warning("Failed to load media.json: %s", exc)

    return templates.TemplateResponse(
        "add-media.html",
        {
            "request": request,
            "v": STATIC_VER,
            "race_key": key,
            "race_name": race["name"],
            "existing_media": existing_media,
        },
    )


@app.post("/race/{key}/add-media")
async def add_media_submit(
    request: Request,
    key: str,
    map_image: Annotated[UploadFile | None, File()] = None,
    link_label_0: Annotated[str, Form()] = "",
    link_url_0: Annotated[str, Form()] = "",
    link_type_0: Annotated[str, Form()] = "video",
    link_label_1: Annotated[str, Form()] = "",
    link_url_1: Annotated[str, Form()] = "",
    link_type_1: Annotated[str, Form()] = "video",
    link_label_2: Annotated[str, Form()] = "",
    link_url_2: Annotated[str, Form()] = "",
    link_type_2: Annotated[str, Form()] = "video",
    link_label_3: Annotated[str, Form()] = "",
    link_url_3: Annotated[str, Form()] = "",
    link_type_3: Annotated[str, Form()] = "video",
):
    """Handle media upload form submission (dev mode only)."""
    if ENV != "dev":
        raise HTTPException(status_code=403, detail="Add media form only available in dev mode")

    # Verify race exists
    race = await get_race(key)
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")

    from .media_utils import generate_thumbnail, save_uploaded_image, update_media_json

    maps_dir = Path(__file__).parent.parent / "maps"
    maps_dir.mkdir(exist_ok=True)

    media_entry = {}

    # Handle image upload
    if map_image and map_image.filename:
        try:
            # Save the uploaded image
            saved_path = await save_uploaded_image(map_image, maps_dir)

            # Generate thumbnail
            await generate_thumbnail(saved_path, maps_dir / "thumbnails")

            # Add to media entry
            media_entry["map"] = {
                "thumbnail": f"maps/thumbnails/{saved_path.name}",
                "target": f"maps/{saved_path.name}",
            }
        except Exception as exc:
            log.error("Failed to process uploaded image: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to process image: {exc}") from exc

    # Handle links
    links = []
    for i in range(4):
        label = locals()[f"link_label_{i}"].strip()
        url = locals()[f"link_url_{i}"].strip()
        link_type = locals()[f"link_type_{i}"]

        if label and url:
            links.append({"label": label, "type": link_type, "url": url})

    # Always set links in media_entry (even if empty) to allow clearing existing links
    media_entry["links"] = links

    # Update media.json
    if media_entry:
        try:
            update_media_json(key, media_entry)
        except Exception as exc:
            log.error("Failed to update media.json: %s", exc)
            raise HTTPException(
                status_code=500, detail=f"Failed to update media.json: {exc}"
            ) from exc

    # Redirect back to race page (use validated race key to prevent redirection attacks)
    safe_key = quote(race["key"], safe="")
    return RedirectResponse(url=f"/race/{safe_key}", status_code=303)


# ---------------------------------------------------------------------------
# JSON API
# ---------------------------------------------------------------------------


@app.get("/api/races")
async def api_races(
    active_days: int | None = Query(None, ge=1),
    commander: str | None = Query(None),
    commander_pos: str | None = Query(None),
):
    # commander      → filter to that cmdr's races AND show their position
    # commander_pos  → show all races but still annotate with that cmdr's position
    effective_cmdr = commander or commander_pos
    filter_cmdr = commander  # only restrict to their races when 'commander' is set
    return await list_races(
        active_days=active_days, commander=filter_cmdr, commander_pos=effective_cmdr
    )


@app.get("/api/races/new")
async def api_new_races(days: int = Query(30, ge=1, le=90), commander: str | None = None):
    return await list_new_races(days=days, commander=commander)


@app.get("/api/races/{key}")
async def api_race(key: str):
    race = await get_race(key)
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")
    return race


@app.get("/api/races/{key}/filtered")
async def api_race_filtered(
    key: str,
    commander: str = Query(..., min_length=1),
    filter_type: str = Query(..., min_length=1),
):
    """
    Fetch filtered leaderboard results directly from the EDCoPilot API.
    Does not store results — this is for real-time filtered views only.

    Filters:
    - NONE: All ships (no filter)
    - PERSONAL: Commander's own results only
    - SMALL: Small ships only
    - MEDIUM: Medium ships only
    - LARGE: Large ships only
    - Or any specific ship type (e.g., "Anaconda", "Python", "SRV")
    """
    if OFFLINE:
        raise HTTPException(
            status_code=503, detail="Filtered leaderboard unavailable in offline mode"
        )

    from datetime import datetime

    import httpx

    # Build the API URL according to the EDCoPilot API format:
    # GET /razapis/getTTResults2/{user}<|>{race}<|>{filter}
    separator = "<|>"
    url = f"https://razzserver.com/razapis/getTTResults2/{commander}{separator}{key}{separator}{filter_type}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            raw_data = resp.json()
    except httpx.RequestError as exc:
        log.warning("Failed to fetch filtered results from EDCoPilot API: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to fetch filtered results") from exc
    except httpx.HTTPStatusError as exc:
        log.warning("EDCoPilot API returned error status %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="EDCoPilot API error") from exc

    if not raw_data:
        return {"results": [], "filter": filter_type, "commander": commander}

    # Parse and format the results
    # Expected format from API: array of arrays with indices:
    # [0]=commander, [1]=updated, [2]=ship, [3]=shipname, [4]=time_ms
    results = []
    prev_time = 0

    for idx, row in enumerate(raw_data, start=1):
        # Validate row has minimum required fields
        if len(row) < 5:
            log.warning(
                f"Skipping malformed row {idx}: insufficient fields (got {len(row)}, expected 5)"
            )
            continue

        time_ms = int(row[4]) if row[4] else 0
        delta_ms = time_ms - prev_time if prev_time > 0 else 0
        prev_time = time_ms

        # Format timestamp (index 1)
        updated = row[1] if row[1] else None
        if updated and isinstance(updated, str):
            try:
                # Parse and format to match our internal format
                dt = datetime.strptime(updated, "%Y-%m-%d %H:%M:%S.%f")
                updated = dt.strftime("%Y-%m-%d %H:%M:%S.%f")
            except (ValueError, AttributeError):
                pass

        results.append(
            {
                "position": idx,
                "name": row[0] if row[0] else "Unknown",
                "ship": row[2] if row[2] else "Unknown",
                "shipname": row[3] if len(row) > 3 and row[3] else None,
                "time_ms": time_ms,
                "delta_ms": delta_ms,
                "improvement_ms": None,  # Not available in filtered results
                "updated": updated,
            }
        )

    return {
        "results": results,
        "filter": filter_type,
        "commander": commander,
        "race_key": key,
    }


@app.get("/api/commanders")
async def api_commanders():
    return await list_commanders()


@app.get("/api/creators")
async def api_creators():
    """Return all race creators with race counts by type."""
    return await list_creators()


@app.get("/api/cmdr/{name}")
async def api_cmdr(name: str):
    stats = await get_commander_stats(name)
    if stats is None:
        raise HTTPException(status_code=404, detail="Commander not found")
    return stats


@app.get("/api/creator/{name}")
async def api_creator(name: str, commander_pos: str | None = Query(None)):
    """Return all races created by a specific commander."""
    data = await get_creator_races(name, commander_pos=commander_pos)
    if data is None:
        raise HTTPException(status_code=404, detail="Creator not found or has no races")
    return data


@app.get("/api/cmdr/{name}/inara")
async def api_cmdr_inara(name: str, force_refresh: bool = Query(False)):
    """Fetch Inara profile data (avatar and profile URL) for a commander."""
    from .inara import get_commander_profile

    profile = await get_commander_profile(name, force_refresh=force_refresh)
    if profile is None:
        raise HTTPException(status_code=404, detail="Inara profile not found")
    return profile


@app.get("/api/stats")
async def api_stats(limit: int | None = Query(None, ge=1, le=100)):
    if limit:
        return await get_stats_with_limit(limit=limit)
    return await get_stats()


@app.get("/api/activity")
async def api_activity(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Return recent race results with commander, race name, position, and timestamp."""
    from .queries import get_recent_activity

    return await get_recent_activity(limit=limit, offset=offset)


@app.get("/api/active-racers")
async def api_active_racers(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Return a distinct list of commanders ordered by their most recent race submission."""
    from .queries import get_active_racers

    return await get_active_racers(limit=limit, offset=offset)


@app.get("/api/thefts")
async def api_thefts(days: int = Query(30, ge=1, le=90)):
    """Return recent podium position thefts and regains across all races."""
    from .queries import get_recent_thefts

    return await get_recent_thefts(days=days)


@app.get("/api/system-coords")
async def api_system_coords(name: str = Query(..., min_length=1, max_length=100)):
    """Proxy to EDSM to resolve a star system name to galaxy coordinates."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://www.edsm.net/api-v1/system",
                params={"systemName": name, "showCoordinates": "1"},
            )
    except httpx.RequestError as exc:
        log.warning("EDSM lookup failed for %r: %s", name, exc)
        raise HTTPException(status_code=502, detail="EDSM lookup failed") from exc
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="EDSM returned an error")
    data = resp.json()
    if not data or "coords" not in data:
        raise HTTPException(status_code=404, detail="System not found")
    c = data["coords"]
    return {"name": data["name"], "x": c["x"], "y": c["y"], "z": c["z"]}


@app.get("/api/system-suggest")
async def api_system_suggest(q: str = Query(..., min_length=1, max_length=100)):
    """Proxy to Spansh autocomplete for star system name suggestions."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://spansh.co.uk/api/systems",
                params={"q": q},
            )
    except httpx.RequestError as exc:
        log.warning("Spansh suggest failed for %r: %s", q, exc)
        raise HTTPException(status_code=502, detail="Spansh lookup failed") from exc
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Spansh returned an error")
    return resp.json()


# Cache for daylight predictions: key → (prediction_dict, confidence_dict, target_dict, fetched_at_monotonic)
_daylight_cache: dict[str, tuple[dict, dict, dict, float]] = {}


@app.get("/api/daylight/{key}")
async def api_daylight(key: str, commander: str = ""):
    """Proxy to the ED Day/Night Calculator for current daylight state at a race start location.

    Responses are cached for 5 minutes per race key to avoid hammering the upstream server.

    Maps the external prediction response to our internal shape:
        { state, next_event, next_event_ms, sun_elevation_deg }

    State derivation:
      - External API returns "day" or "night".
      - We treat sun_altitude_deg < 10° as a twilight zone:
          day + rising  → "dawn"
          day + setting → "dusk"
    """
    import time
    from datetime import timezone

    import httpx

    cmdr_allowed = bool(commander and commander.strip().lower() in DAYLIGHT_API_ENABLED_FOR)
    if not DAYLIGHT_API_ENABLED and not cmdr_allowed:
        raise HTTPException(status_code=503, detail="Day/Night API is disabled")

    now_mono = time.monotonic()
    cached = _daylight_cache.get(key)
    if cached and (now_mono - cached[3]) < DAYLIGHT_CACHE_TTL:
        pred, confidence, target = cached[0], cached[1], cached[2]
        query = cached[4] if len(cached) > 4 else {}
        log.debug("Daylight cache hit for race %r", key)
    else:
        try:
            async with httpx.AsyncClient(timeout=DAYLIGHT_API_TIMEOUT) as client:
                resp = await client.get(
                    f"{DAYLIGHT_API_BASE_URL}/public/api/v1/prediction",
                    params={"race_key": key},
                )
        except httpx.RequestError as exc:
            log.warning("Day/Night Calculator unreachable for race %r: %s", key, exc)
            raise HTTPException(status_code=502, detail="Day/Night Calculator unreachable") from exc

        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Race not found in Day/Night Calculator")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Day/Night Calculator returned an error")

        data = resp.json()
        if "error" in data:
            code = data["error"].get("code", "unknown")
            if code == "not_found":
                raise HTTPException(
                    status_code=404, detail="Race not found in Day/Night Calculator"
                )
            raise HTTPException(status_code=502, detail=f"Day/Night Calculator error: {code}")

        pred = data.get("prediction", {})
        confidence = data.get("model_confidence", {})
        target = data.get("target", {})
        query = data.get("query", {})
        _daylight_cache[key] = (pred, confidence, target, now_mono, query)
        log.debug("Daylight cache miss for race %r — fetched fresh", key)

    # Derive state — add dawn/dusk twilight zones (sun within 10° of horizon)
    raw_state = pred.get("state", "day")
    sun_alt = pred.get("sun_altitude_deg", 90.0)
    sun_motion = pred.get("sun_motion", "")

    if raw_state == "day" and sun_alt < 10.0:
        state = "dawn" if sun_motion == "rising" else "dusk"
    else:
        state = raw_state  # "day" or "night"

    # Re-derive next_event_ms on every request — it counts down in real time
    now_utc = datetime.now(tz=timezone.utc)

    def _ms_to(utc_str: str | None) -> int | None:
        if not utc_str:
            return None
        try:
            dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
            return max(0, int((dt - now_utc).total_seconds() * 1000))
        except ValueError:
            return None

    ms_to_sunrise = _ms_to(pred.get("next_sunrise_utc"))
    ms_to_sunset = _ms_to(pred.get("next_sunset_utc"))

    # day/dawn/dusk → sun above horizon, next event is sunset
    # night → sun below horizon, next event is sunrise
    if state in ("day", "dawn", "dusk"):
        next_event = "sunset"
        next_event_ms = ms_to_sunset
    else:
        next_event = "sunrise"
        next_event_ms = ms_to_sunrise

    # Persist to daylight_cache table (collapsed to day/night only)
    db_state = "day" if state in ("day", "dawn", "dusk") else "night"
    until_utc = pred.get("next_sunset_utc") if db_state == "day" else pred.get("next_sunrise_utc")
    # Fallback: if crossing times aren't in the response (e.g. tidally locked planet),
    # use prediction_hours from the query stanza as the validity window, or 72h if absent.
    if not until_utc:
        from datetime import timedelta

        prediction_hours = query.get("prediction_hours") if query else None
        hours = float(prediction_hours) if prediction_hours else 72.0
        until_utc = (now_utc + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    from .database import get_db as _get_db

    _db = await _get_db()
    try:
        await _db.execute(
            """INSERT INTO daylight_cache (race_key, state, until_utc, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(race_key) DO UPDATE SET
                 state=excluded.state,
                 until_utc=excluded.until_utc,
                 updated_at=excluded.updated_at""",
            (key, db_state, until_utc, now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")),
        )
        await _db.commit()
    finally:
        await _db.close()

    return {
        "state": state,
        "next_event": next_event,
        "next_event_ms": next_event_ms,
        "sun_elevation_deg": sun_alt,
        "sun_motion": sun_motion or None,
        "confidence_score": confidence.get("score"),
        "confidence_level": confidence.get("level"),
        "link": _eddaynight_link(target),
        "prediction": pred,
    }


def _eddaynight_link(target: dict) -> str:
    body_id = target.get("body_id")
    poi_id = target.get("poi_id")
    if body_id is not None and poi_id is not None:
        return f"{DAYLIGHT_API_BASE_URL}/bodies/{body_id}?poi={poi_id}"
    return DAYLIGHT_API_BASE_URL + "/"


@app.get("/api/race-map/{key}")
async def api_race_map(key: str):
    """Returns the media data for a given race key (map + optional links)."""
    media_file = Path(__file__).parent.parent / "media.json"
    if not media_file.exists():
        return {}

    try:
        with open(media_file) as f:
            media_data = json.load(f)
        race_media = media_data.get(key, {})

        # In production, serve map images from GitHub
        if ENV == "prod" and "map" in race_media:
            github_prefix = "https://raw.githubusercontent.com/vladigor/ed-timetrials-leaderboard/refs/heads/main/"
            map_data = race_media["map"]

            # Prepend GitHub URL if paths are relative (don't start with http)
            if "thumbnail" in map_data and not map_data["thumbnail"].startswith("http"):
                map_data["thumbnail"] = github_prefix + map_data["thumbnail"]
            if "target" in map_data and not map_data["target"].startswith("http"):
                map_data["target"] = github_prefix + map_data["target"]

        return race_media
    except Exception as exc:
        log.warning("Failed to load media.json: %s", exc)
        return {}


@app.get("/api/media")
async def api_media():
    """Returns the entire media.json file."""
    media_file = Path(__file__).parent.parent / "media.json"
    if not media_file.exists():
        return {}

    try:
        with open(media_file) as f:
            media_data = json.load(f)
        return media_data
    except Exception as exc:
        log.warning("Failed to load media.json: %s", exc)
        return {}


@app.get("/api/poll")
async def api_poll():
    """
    Returns the current last-updated map plus server mode flags.
    The browser uses this to detect data changes and to set the status indicator.
    """
    return {"offline": OFFLINE, "last_updated": get_last_updated_snapshot()}


@app.get("/api/poll/debug")
async def api_poll_debug():
    """Return poll loop diagnostics to help troubleshoot stale live updates."""
    return {
        "offline": OFFLINE,
        "poll": get_poll_debug_status(),
    }
