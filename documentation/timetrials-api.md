# EDCoPilot Time Trials API

All endpoints are on the EDCoPilot backend server:

- **Production:** `https://razzserver.com/razapis/`
- **Test/mirror:** `https://raztest.ddns.net/razapis/`

All requests use **HTTP GET**. Parameters are passed as path segments, URL-encoded.
The separator between multiple parameters within a single path segment is `<|>` (URL-encoded: `%3C%7C%3E`).

> **Leaderboard user parameter:** The leaderboard app uses the special user value `LEADERBOARD` in
> place of a personal username. This unlocks aggregate/full data responses for all endpoints it
> supports. Personal endpoints such as `getTTBestTime` and `getTTWIP` are not meaningful with this
> user value.

---

## Parameter Reference

| Symbol | Description |
|---|---|
| `{user}` | The EDCoPilot username (e.g. `VLADIGOR`), or `LEADERBOARD` for aggregate data |
| `{race}` | The race key (e.g. `RAZZAFRAG03`). **Not** the display name — see `getTTList` row[0] |
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

Returns the full list of available time trial events visible to the user. With `LEADERBOARD` as
the user, returns all 100+ public races.

**Example:**
```
GET https://razzserver.com/razapis/getTTList/LEADERBOARD
```

**Response:** JSON array of arrays. Each inner array has **15 elements**:

| Index | Field | Type | Example | Notes |
|---|---|---|---|---|
| 0 | `key` | string | `"RAZZAFRAG03"` | Unique race identifier. Use this — not the name — in all other endpoints |
| 1 | `name` | string | `"The Kessel Run (SRV Edition) - 1 Lap"` | Human-readable display name |
| 2 | `system` | string | `"Las Velini"` | Star system name |
| 3 | `station` | string | `"Kessel Bastion"` | Station/settlement/orbital name (may be empty) |
| 4 | `coords` | string | `"143.00000,6.59375,-7.65625"` | Galactic XYZ coordinates of the system |
| 5 | `type` | string | `"SRV"` | Vehicle type: `SRV`, `SHIP`, `ONFOOT`, or `FIGHTER` |
| 6 | `unknown6` | string | `"N/A"` | Purpose unknown. Observed: `"N/A"` or empty |
| 7 | `version` | string | `"ODY"` | Game version: `"ODY"` (Odyssey) or `"HRZ"` (Horizons) |
| 8 | `address` | string | `""` | Additional location address/description (often empty) |
| 9 | `status` | string | `"PROD"` | Race status: `"PROD"` (live), `"WIP"` (work-in-progress) |
| 10 | `unknown10` | string | `"216"` | Numeric string. Possibly race ID or sort weight |
| 11 | `constraint_str` | string | `""` | Ship/vehicle constraint definitions (see constraint format below) |
| 12 | `global_constraint` | string | `""` | Global constraint value; defaults to `"1"` if empty |
| 13 | `unknown13` | string | `""` | Purpose unknown. Usually empty |
| 14 | `circuit_race` | string | `"False"` | `"True"` for circuit/flying-start races (ShipPass/FighterFlyingStart checkpoints). **Does NOT indicate multi-vessel.** Multi-vessel must be derived from the waypoints in `getTTData` — see below |

**Constraint string format (row[11]):**  
Pairs separated by `**`. Each pair is `KEY=VALUE` (integer value). If a pair has no `=`,
the global constraint value (row[12]) is used as the value. Example: `"Hull=50**Speed=300"`.

---

### 2. `getTTData` — Get details for a specific time trial

```
GET /razapis/getTTData/{user}<|>{race}
```

Returns the race definition including a human-readable description and the full ordered list of
checkpoints with navigation instructions.

**Example (`LEADERBOARD` user works here):**
```
GET https://razzserver.com/razapis/getTTData/LEADERBOARD%3C%7C%3ERAZZAFRAG03
```

**Response:** JSON array containing one inner array with **2 elements**:

```json
[
  [
    "A single lap race around Kessel Bastion. Watch out for the big jump needed near the end!",
    "SRV:Las Velini~Las Velini B 2~47.4517,-145.6122~~50~~Instruction text.``SRV:Las Velini~..."
  ]
]
```

| Index | Field | Notes |
|---|---|---|
| `[0][0]` | `description` | Plain-text race description shown to the player before starting |
| `[0][1]` | `waypoints` | Checkpoint string — see waypoint format below |

#### Waypoint string format

Checkpoints are delimited by ` `` ` (double backtick). Each checkpoint is a `~`-delimited record:

```
TYPE:System~Station~Body~Lat,Lon~unknown~Range~Instruction~~TerseInstruction~Intro~Body~...
```

| Field | Index | Example | Notes |
|---|---|---|---|
| Type prefix | 0 (before `:`) | `SRV`, `Ship`, `OnFoot`, `Fighter`, `FighterFlyingStart`, `SupercruiseDestinationDrop` | Combined with the system name in field 0 after `:` |
| System | 0 (after `:`) | `Las Velini` | Star system name |
| Station | 1 | `Las Velini B 2` | Landing body or station (may be empty) |
| Body | 2 | `Las Velini B 2` | Specific moon/planet body (may equal station, or be empty) |
| Coords | 3 | `47.4517,-145.6122` | Lat/lon on the body surface (empty for space waypoints) |
| Unknown | 4 | `0` or empty | Purpose unclear |
| Range | 5 | `50` | Proximity radius in metres (how close the player must get to register the waypoint) |
| Max height | 6 (Fighter only) | `600` | Maximum permitted altitude in metres (Fighter races only) |
| Instruction | 7 | `"Now race towards…"` | Full navigation instruction displayed to the player |
| Sub-fields | 8+ | Separated by `~` and `~~~` | Additional instruction variants (terse, intro, body text, etc.); internal to EDCoPilot |

**Separator summary:**

| Separator | Meaning |
|---|---|
| ` `` ` (double backtick) | Delimiter between checkpoints |
| `^^` | Separator between full and terse instruction within a single checkpoint field |
| `~~~` | Sub-field separator within later checkpoint fields (EDCoPilot internal) |
| `~~` | Sub-field separator (lighter weight) |

**Derived statistics** (computed by the leaderboard app from the waypoints string):

| Stat | How |
|---|---|
| `num_checkpoints` | Count of ` `` `-delimited segments |
| `multi_planet` | `true` if ≥2 distinct celestial body names appear across all checkpoints |
| `multi_system` | `true` if ≥2 distinct system names appear across all checkpoints |
| `multi_mode` | `true` if ≥2 distinct *base* vehicle types appear across all checkpoints. Extract the type prefix before `:` in each segment's first field and normalise: `Ship`/`ShipFlyingStart`/`ShipPass` → `Ship`; `Fighter`/`FighterFlyingStart` → `Fighter`; `SRV` → `SRV`; `OnFoot` → `OnFoot`. Example: the Khazad-dum Biathlon has `ShipPass` checkpoints followed by `SRV` checkpoints → `multi_mode = true`. **Do not use `getTTList` row[14] for this** — that field flags circuit/flying-start races, not multi-mode races |

---

### 3. `getTTResults` — Get leaderboard results for a time trial

```
GET /razapis/getTTResults/{user}<|>{race}
```

> **Note:** The leaderboard app uses `getTTResults`, not `getTTResults2`. Both appear to exist;
> `getTTResults` is the simpler endpoint that does not take a filter parameter.

Returns the full result list for a specific race. With `LEADERBOARD` as the user this returns all
entries across all commanders.

**Example:**
```
GET https://razzserver.com/razapis/getTTResults/LEADERBOARD%3C%7C%3ERAZZAFRAG03
```

**Response:** JSON array of arrays. Each inner array has **5 elements**:

| Index | Field | Type | Example |
|---|---|---|---|
| 0 | `commander` | string | `"CMDR Razz"` |
| 1 | `updated` | string | `"2025-03-14 09:26:11.123456"` — format: `%Y-%m-%d %H:%M:%S.%f` |
| 2 | `ship` | string | `"SRV"` — ship/vehicle type abbreviation |
| 3 | `shipname` | string | `"My SRV"` — player-assigned ship name (may be empty) |
| 4 | `time_ms` | integer | `142310` — elapsed time in milliseconds |

---

### 4. `getTTResultsLU` — Get last-updated timestamps for all races

```
GET /razapis/getTTResultsLU/{user}
```

Returns the timestamp of the most recent result submission for every race. Used for efficient
delta-polling: only fetch full results for races whose timestamp has changed.

**Example:**
```
GET https://razzserver.com/razapis/getTTResultsLU/LEADERBOARD
```

**Response:** JSON array of two-element arrays `[key, timestamp]`:

```json
[
  ["RAZZAFRAG03", "2025-04-01 12:34:56.789000"],
  ["ALICE KNIGHT-BEAGLE01", "2025-03-20 08:00:00.000000"],
  ...
]
```

| Index | Field | Notes |
|---|---|---|
| 0 | `key` | Race key (matches `getTTList` row[0]) |
| 1 | `updated` | Datetime string in `%Y-%m-%d %H:%M:%S.%f` format (UTC) |

---

### 5. `getTTShipsRaced` — Get ships that have raced a time trial

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

### 6. `getTTResults2` — Get filtered leaderboard results for a time trial

```
GET /razapis/getTTResults2/{user}<|>{race}<|>{filter}
```

Returns the leaderboard results for a specific time trial, optionally filtered by ship size or
personal scores. Variant of `getTTResults` that accepts a filter parameter.

**Example (no filter):**
```
GET https://razzserver.com/razapis/getTTResults2/VLADIGOR%3C%7C%3EVR247-DW3%20SENTINEL'S%20SALUTE%3C%7C%3ENONE
```

**Example (medium ships only):**
```
GET https://razzserver.com/razapis/getTTResults2/VLADIGOR%3C%7C%3EVR247-DW3%20SENTINEL'S%20SALUTE%3C%7C%3EMEDIUM
```

---

### 7. `getTTBestTime` — Get the user's personal best time for a time trial

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

### 8. `getTTWIP` — Get the number of time trials in progress

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

### 9. `getTTPositions` — Get the user's position/standings across time trials

```
GET /razapis/getTTPositions/{user}
```

Returns the user's leaderboard positions across all time trials they have completed.

**Example:**
```
GET https://razzserver.com/razapis/getTTPositions/VLADIGOR
```

---

## Endpoints used by the leaderboard app

The leaderboard app uses the `LEADERBOARD` pseudo-user and calls only these three endpoints:

| Endpoint | When |
|---|---|
| `getTTList/LEADERBOARD` | On startup — builds the race/location list |
| `getTTResultsLU/LEADERBOARD` | On startup and every 60 s poll — detects changed races |
| `getTTResults/LEADERBOARD<\|>{key}` | On startup (for changed races) and after each poll delta |
| `getTTData/LEADERBOARD<\|>{key}` | On startup, once per race — enriches race metadata (description, checkpoints) |

## Typical EDCoPilot client call sequence

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

- The `race` parameter in all multi-parameter endpoints is the **key** (row[0] from `getTTList`), not the display name. Keys look like `RAZZAFRAG03` or `ALICE KNIGHT-BEAGLE01`.
- The `getTTBestTime` endpoint is also mirrored to `raztest.ddns.net` immediately after the primary call to `razzserver.com`.
- All endpoints return HTTP `200` on success. A response body of `None` indicates an empty/null result.
- Race keys are case-sensitive and must be URL-encoded in all requests.
- The `<|>` separator (`%3C%7C%3E`) is used consistently as the multi-parameter delimiter within path segments.
- Datetime strings are always in `%Y-%m-%d %H:%M:%S.%f` format and should be treated as UTC.
