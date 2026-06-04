# Daylight API — Design Specification

This document describes the expected contract for the `/api/daylight/{key}` internal endpoint
and the external API it would consume. It covers what the leaderboard frontend already expects
today so that your friend can build against a fixed target.

---

## Internal endpoint

### `GET /api/daylight/{key}`

Returns the current daylight state at the location of a specific race.

**Path parameter**

| Parameter | Description |
|---|---|
| `key` | Race key (URL-encoded), matching `locations.key` in the database — e.g. `RAZZAFRAG03` |

**Success response — HTTP 200**

```json
{
  "state":            "dusk",
  "next_event":       "night",
  "next_event_ms":    3720000,
  "sun_elevation_deg": -4.2
}
```

**Response fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `state` | string | ✓ | Current daylight phase. One of `"day"`, `"dawn"`, `"dusk"`, `"night"` |
| `next_event` | string | ✓ | The phase transition coming next. One of `"sunrise"`, `"dawn"`, `"dusk"`, `"sunset"`, `"night"` |
| `next_event_ms` | integer | ✓ | Milliseconds until `next_event` occurs |
| `sun_elevation_deg` | number | — | Current sun elevation angle in degrees above/below the horizon. Negative = below horizon. Optional but recommended — may be used for future ambient intensity scaling |

**Phase definitions**

| `state` | Sun elevation | Description |
|---|---|---|
| `"day"` | > ~6° | Full daylight |
| `"dawn"` | −6° to +6° (rising) | Civil twilight, pre-sunrise transition |
| `"dusk"` | −6° to +6° (setting) | Civil twilight, post-sunset transition |
| `"night"` | < ~−6° | Full night |

> These thresholds are guidelines. The external API may use its own definitions; as long as it
> maps cleanly to one of the four states above, the frontend will handle it correctly.

**Error responses**

| HTTP status | When to return |
|---|---|
| 404 | Race key not found in the database, or the race has no known coordinates |
| 503 | External daylight API is unavailable or timed out |

The frontend silently ignores all non-200 responses — the race page renders normally without
the ambient overlay when this endpoint is absent or returns an error.

---

## Backend implementation notes

### Data source

The system name for a race is stored in `locations.system` and its galactic XYZ coordinates
in `locations.coords` (format: `"x,y,z"`). The handler needs to:

1. Look up the race by `key` in the database.
2. Resolve the star system's real-space coordinates to a body/planet body position — the
   external API (below) may accept the system name directly.
3. Call the external API and translate its response into the response shape above.
4. Return the result. Consider a short TTL cache (e.g. 60 s) keyed on `key` to avoid
   hitting the external API on every page load.

### Suggested handler skeleton (FastAPI)

```python
@app.get("/api/daylight/{key}")
async def api_daylight(key: str):
    """
    Returns current daylight state at the location of race `key`.
    Returns 404 if the race is unknown or has no coordinates.
    Returns 503 if the external daylight API is unavailable.
    """
    db = await get_db()
    try:
        row = await db.execute_fetchone(
            "SELECT system, coords FROM locations WHERE key = ?", (key,)
        )
        if not row or not row["coords"]:
            raise HTTPException(status_code=404, detail="Race not found or has no coordinates")

        system = row["system"]
        coords = row["coords"]  # "x,y,z"

        data = await fetch_daylight(system, coords)   # call external API
        return data
    finally:
        await db.close()
```

---

## External API (friend's API)

The details below are a proposed contract. If the external API has a different shape, the
`fetch_daylight()` helper in `main.py` is the only translation layer that needs updating —
the frontend contract above stays fixed.

### Proposed request

```
GET /daylight?system={system_name}
```

or, if coordinate-based lookup is preferred:

```
GET /daylight?x={x}&y={y}&z={z}
```

### Proposed response

```json
{
  "state":             "dusk",
  "sun_elevation_deg": -4.2,
  "next_sunset_ms":    null,
  "next_sunrise_ms":   18340000
}
```

The mapping from this to the internal response shape is straightforward — `next_event` and
`next_event_ms` are derived from whichever of `next_sunset_ms` / `next_sunrise_ms` is
non-null and soonest, and `state` maps directly.

> **Note:** Elite Dangerous day lengths vary hugely by body — from a few minutes to many
> real-world hours. Times-until-event expressed in milliseconds allow sub-minute precision
> for fast-rotating bodies.

---

## Frontend consumption (already implemented)

`static/js/race.js` calls `loadDaylightState()` on page load. This function:

1. Fetches `/api/daylight/{raceKey}`.
2. On success, calls `applyDaylightState(data)` which:
   - Sets `data-daylight="{state}"` on `.race-detail-header-wrapper` — triggers the CSS
     ambient glow and horizon-bar overlay.
   - Injects an info badge (e.g. `☀️ Daytime · Sunset in 2h 15m`) into the race info row.
3. On any non-200 response, silently does nothing — the page renders without the overlay.

The badge and overlay are re-applied on every `renderRace()` call (e.g. after a filter change
or poller refresh) using the cached `daylightData` value, so they persist across re-renders.

### Preview / testing

Append `?daylight=` to any race URL to bypass the API and apply mock data locally:

```
/race/RAZZAFRAG03?daylight=day
/race/RAZZAFRAG03?daylight=dawn
/race/RAZZAFRAG03?daylight=dusk
/race/RAZZAFRAG03?daylight=night
```

This works without the external API being live and is safe to use in production (the parameter
has no server-side effect).
