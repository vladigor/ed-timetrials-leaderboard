# Daylight API

The leaderboard fetches current daylight state for each race's start location and uses it to
drive an ambient visual overlay and info badge on the race page. This document describes the
full stack: configuration, the internal endpoint, the upstream API, and the frontend.

---

## Configuration

All daylight settings live in `.env` and are read once at startup via `app/config.py`.

| Variable | Default | Description |
|---|---|---|
| `DAYLIGHT_API_ENABLED` | `true` | Set to `false` to disable the feature entirely. The endpoint returns 503 and the frontend silently shows no badge or overlay. |
| `DAYLIGHT_API_TIMEOUT` | `15.0` | Seconds to wait for the upstream API before giving up. |
| `DAYLIGHT_CACHE_TTL` | `300` | Seconds to cache an upstream response per race key before re-fetching (5 minutes). `next_event_ms` is recalculated on every request from the cached timestamps, so the countdown stays accurate without hitting the upstream server. |

---

## Internal endpoint

### `GET /api/daylight/{key}`

Implemented in `app/main.py` (`api_daylight`). Proxies to the ED Day/Night Calculator,
applies twilight zone logic, and returns a normalised response shape.

**Path parameter**

| Parameter | Description |
|---|---|
| `key` | Race key (URL-encoded) — e.g. `RICK%20RAZZAFRAG-TURNERSHIP02` |

**Success response — HTTP 200**

```json
{
  "state":             "dusk",
  "next_event":        "sunrise",
  "next_event_ms":     3720000,
  "sun_elevation_deg": -4.2
}
```

**Response fields**

| Field | Type | Description |
|---|---|---|
| `state` | string | Current daylight phase: `"day"`, `"dawn"`, `"dusk"`, or `"night"` |
| `next_event` | string | Next transition: `"sunrise"` or `"sunset"` |
| `next_event_ms` | integer | Milliseconds until `next_event`. Recalculated fresh on every request. |
| `sun_elevation_deg` | number | Sun elevation in degrees. Negative = below horizon. |

**State derivation**

The upstream API returns only `"day"` or `"night"`. We layer on twilight zones:

| Condition | `state` |
|---|---|
| upstream `"day"`, altitude ≥ 10°, any motion | `"day"` |
| upstream `"day"`, altitude < 10°, rising | `"dawn"` |
| upstream `"day"`, altitude < 10°, setting | `"dusk"` |
| upstream `"night"` | `"night"` |

**Error responses**

| HTTP status | Cause |
|---|---|
| 404 | Race key not found in the Day/Night Calculator |
| 503 | `DAYLIGHT_API_ENABLED=false` |
| 502 | Upstream unreachable, timed out, or returned an unexpected error |

The frontend silently ignores all non-200 responses — the page renders normally without the
overlay.

---

## Upstream API — ED Day/Night Calculator

- **Base URL:** `https://eddaynight.de/public/api/v1`
- **Docs:** `documentation/day-night-calc-api.md`

We use the race-key lookup method:

```
GET /public/api/v1/prediction?race_key={key}
```

Race keys in the Day/Night Calculator correspond directly to race keys in this app. The
upstream server is a Raspberry Pi behind a Cloudflare tunnel — responses can be slow,
hence the generous default timeout and the in-memory cache.

**Relevant upstream response fields we consume**

| Field | Used for |
|---|---|
| `prediction.state` | Base day/night state |
| `prediction.sun_altitude_deg` | Twilight zone detection |
| `prediction.sun_motion` | `"rising"` / `"setting"` for dawn vs dusk |
| `prediction.next_sunrise_utc` | Countdown for night/dusk states |
| `prediction.next_sunset_utc` | Countdown for day/dawn states |

---

## Frontend

`static/js/race.js` calls `loadDaylightState()` on page load (fire-and-forget):

1. Fetches `/api/daylight/{raceKey}`.
2. Caches the result in `daylightData` (module-level variable).
3. Calls `applyDaylightState(data)` which:
   - Sets `data-daylight="{state}"` on `.race-detail-header-wrapper` — triggers CSS ambient
     glow (`::before`) and horizon bar (`::after`) overlays.
   - Injects an info badge (e.g. `🌇 Dusk · Sunrise in 12h 4m`) into the race info row.
4. On any non-200 response, silently does nothing.

`applyDaylightState(daylightData)` is also called at the end of every `renderRace()` so the
badge and overlay survive filter changes and poller re-renders.

### Preview / testing (no API required)

Append `?daylight=` to any race URL to apply mock data locally, bypassing the API entirely:

```
/race/RAZZAFRAG03?daylight=day
/race/RAZZAFRAG03?daylight=dawn
/race/RAZZAFRAG03?daylight=dusk
/race/RAZZAFRAG03?daylight=night
```

This is safe in production — the parameter has no server-side effect.
