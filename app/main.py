"""FastAPI application entry point."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from .config import OFFLINE
from .database import init_db
from .scheduler import full_refresh, get_last_updated_snapshot, start_scheduler
from .queries import list_races, get_race, list_commanders, get_commander_stats

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent.parent / "static"
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


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

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------------------------------------------------------------------------
# HTML pages
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(TEMPLATES_DIR / "index.html")


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico", media_type="image/x-icon")


@app.get("/site.webmanifest")
async def webmanifest():
    return FileResponse(STATIC_DIR / "site.webmanifest", media_type="application/manifest+json")


@app.get("/race/{key}", response_class=HTMLResponse)
async def race_page(key: str):
    return FileResponse(TEMPLATES_DIR / "race.html")


@app.get("/cmdr/{name}", response_class=HTMLResponse)
async def cmdr_page(name: str):
    return FileResponse(TEMPLATES_DIR / "cmdr.html")


# ---------------------------------------------------------------------------
# JSON API
# ---------------------------------------------------------------------------

@app.get("/api/races")
async def api_races(
    active_days: Optional[int] = Query(None, ge=1),
    commander: Optional[str] = Query(None),
    commander_pos: Optional[str] = Query(None),
):
    # commander      → filter to that cmdr's races AND show their position
    # commander_pos  → show all races but still annotate with that cmdr's position
    effective_cmdr = commander or commander_pos
    filter_cmdr    = commander  # only restrict to their races when 'commander' is set
    return await list_races(active_days=active_days, commander=filter_cmdr, commander_pos=effective_cmdr)


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
        raise HTTPException(status_code=502, detail="EDSM lookup failed")
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
        raise HTTPException(status_code=502, detail="Spansh lookup failed")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Spansh returned an error")
    return resp.json()


@app.get("/api/poll")
async def api_poll():
    """
    Returns the current last-updated map plus server mode flags.
    The browser uses this to detect data changes and to set the status indicator.
    """
    return {"offline": OFFLINE, "last_updated": get_last_updated_snapshot()}
