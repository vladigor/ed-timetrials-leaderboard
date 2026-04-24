"""FastAPI application entry point."""

from __future__ import annotations

import logging
import mimetypes
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import markdown
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import OFFLINE
from .database import init_db
from .queries import (
    get_commander_stats,
    get_race,
    get_stats,
    get_stats_with_limit,
    list_commanders,
    list_new_races,
    list_races,
)
from .scheduler import full_refresh, get_last_updated_snapshot, start_scheduler

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
    return templates.TemplateResponse("index.html", {"request": request, "v": STATIC_VER})


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico", media_type="image/x-icon")


@app.get("/site.webmanifest")
async def webmanifest():
    return FileResponse(STATIC_DIR / "site.webmanifest", media_type="application/manifest+json")


@app.get("/race/{key}", response_class=HTMLResponse)
async def race_page(request: Request, key: str):
    return templates.TemplateResponse("race.html", {"request": request, "v": STATIC_VER})


@app.get("/cmdr/{name}", response_class=HTMLResponse)
async def cmdr_page(request: Request, name: str):
    return templates.TemplateResponse("cmdr.html", {"request": request, "v": STATIC_VER})


@app.get("/about", response_class=HTMLResponse)
async def about_page(request: Request):
    return templates.TemplateResponse("about.html", {"request": request, "v": STATIC_VER})


@app.get("/stats", response_class=HTMLResponse)
async def stats_page(request: Request):
    return templates.TemplateResponse("stats.html", {"request": request, "v": STATIC_VER})


@app.get("/activity", response_class=HTMLResponse)
async def activity_page(request: Request):
    return templates.TemplateResponse("activity.html", {"request": request, "v": STATIC_VER})


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
async def api_new_races(days: int = Query(7, ge=1, le=90)):
    return await list_new_races(days=days)


@app.get("/api/races/{key}")
async def api_race(key: str):
    race = await get_race(key)
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")
    return race


@app.get("/api/commanders")
async def api_commanders():
    return await list_commanders()


@app.get("/api/cmdr/{name}")
async def api_cmdr(name: str):
    stats = await get_commander_stats(name)
    if stats is None:
        raise HTTPException(status_code=404, detail="Commander not found")
    return stats


@app.get("/api/stats")
async def api_stats(limit: int | None = Query(None, ge=1, le=100)):
    if limit:
        return await get_stats_with_limit(limit=limit)
    return await get_stats()


@app.get("/api/activity")
async def api_activity(limit: int = Query(20, ge=1, le=100)):
    """Return recent race results with commander, race name, position, and timestamp."""
    from .queries import get_recent_activity

    return await get_recent_activity(limit=limit)


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


@app.get("/api/race-map/{key}")
async def api_race_map(key: str):
    """Returns the media data for a given race key (map + optional links)."""
    media_file = Path(__file__).parent.parent / "media.json"
    if not media_file.exists():
        return {}

    import json

    try:
        with open(media_file) as f:
            media_data = json.load(f)
        race_media = media_data.get(key, {})
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

    import json

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
