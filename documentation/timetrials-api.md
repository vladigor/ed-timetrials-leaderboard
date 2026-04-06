# EDCoPilot Time Trials API

All endpoints are on the EDCoPilot backend server:

- **Production:** `https://razzserver.com/razapis/`
- **Test/mirror:** `https://raztest.ddns.net/razapis/`

All requests use **HTTP GET**. Parameters are passed as path segments, URL-encoded.
The separator between multiple parameters within a single path segment is `<|>` (URL-encoded: `%3C%7C%3E`).

---

## Parameter Reference

| Symbol | Description |
|---|---|
| `{user}` | The EDCoPilot username (e.g. `VLADIGOR`) |
| `{race}` | The full race/time trial name (e.g. `VR247-DW3 SENTINEL'S SALUTE`) |
| `{filter}` | Leaderboard ship-size filter (see filter values below) |

### Leaderboard filter values (`{filter}`)

| Value | Description |
|---|---|
| `NONE` | No filter — show all ships |
| `MEDIUM` | Medium-size ships only |
| `PERSONAL` | Current user's own results only |

---

## Endpoints

### 1. `getTTList` — Get all time trials

```
GET /razapis/getTTList/{user}
```

Returns the full list of available time trial events visible to the user.

**Example:**
```
GET https://razzserver.com/razapis/getTTList/VLADIGOR
```

---

### 2. `getTTData` — Get details for a specific time trial

```
GET /razapis/getTTData/{user}<|>{race}
```

Returns the definition/details of a single time trial, including waypoint and course data.
This is the primary endpoint for viewing a specific time trial.

**Example:**
```
GET https://razzserver.com/razapis/getTTData/VLADIGOR%3C%7C%3EVR247-DW3%20SENTINEL'S%20SALUTE
```

---

### 3. `getTTShipsRaced` — Get ships that have raced a time trial

```
GET /razapis/getTTShipsRaced/{user}<|>{race}
```

Returns the list of ship types that have been used to complete a specific time trial.
Used to populate the ship-filter dropdown on the leaderboard.

**Example:**
```
GET https://razzserver.com/razapis/getTTShipsRaced/VLADIGOR%3C%7C%3EVR247-DW3%20SENTINEL'S%20SALUTE
```

---

### 4. `getTTResults2` — Get leaderboard results for a time trial

```
GET /razapis/getTTResults2/{user}<|>{race}<|>{filter}
```

Returns the leaderboard results for a specific time trial, optionally filtered by ship size or personal scores.

**Example (no filter):**
```
GET https://razzserver.com/razapis/getTTResults2/VLADIGOR%3C%7C%3EVR247-DW3%20SENTINEL'S%20SALUTE%3C%7C%3ENONE
```

**Example (medium ships only):**
```
GET https://razzserver.com/razapis/getTTResults2/VLADIGOR%3C%7C%3EVR247-DW3%20SENTINEL'S%20SALUTE%3C%7C%3EMEDIUM
```

---

### 5. `getTTBestTime` — Get the user's personal best time for a time trial

```
GET /razapis/getTTBestTime/{user}<|>{race}
```

Returns the personal best time recorded by the specified user for the given time trial.
The response body contains the time value directly (e.g. `4`).

**Example:**
```
GET https://razzserver.com/razapis/getTTBestTime/VLADIGOR%3C%7C%3EVR247-DW3%20SENTINEL'S%20SALUTE
```

---

### 6. `getTTWIP` — Get the number of time trials in progress / work-in-progress count

```
GET /razapis/getTTWIP/{user}
```

Returns a count of time trials that are currently work-in-progress (WIP) for the user.
The response body contains the count directly (e.g. `2`).

**Example:**
```
GET https://razzserver.com/razapis/getTTWIP/VLADIGOR
```

---

### 7. `getTTPositions` — Get the user's position/standings across time trials

```
GET /razapis/getTTPositions/{user}
```

Returns the user's leaderboard positions across all time trials they have completed.

**Example:**
```
GET https://razzserver.com/razapis/getTTPositions/VLADIGOR
```

---

## Typical call sequence

When a user opens the Time Trials panel in EDCoPilot, the following calls are made in order:

1. `getTTList` — populate the list of available races
2. `getTTWIP` — check for any WIP races
3. `getTTPositions` — load the user's standings

When a user selects a specific time trial:

4. `getTTData` — load race definition/details
5. `getTTShipsRaced` — populate the ship filter
6. `getTTResults2` (with current filter) — load leaderboard

When a race is started or a personal best is set:

7. `getTTBestTime` — refresh the user's personal best

---

## Notes

- The `getTTBestTime` endpoint is also mirrored to `raztest.ddns.net` immediately after the primary call to `razzserver.com`.
- All endpoints return HTTP `200` on success. A response body of `None` indicates an empty/null result.
- Race names are case-sensitive and must be URL-encoded in all requests.
- The `<|>` separator (`%3C%7C%3E`) is used consistently as the multi-parameter delimiter within path segments.
