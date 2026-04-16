# Database Schema

SQLite database at `leaderboard.sqlite3`. WAL mode is enabled. Foreign key enforcement is on.

---

## Tables

### `locations`

One row per time trial race. Populated from `getTTList` and enriched by `getTTData`.

| Column | Type | Default | Description |
|---|---|---|---|
| `key` | TEXT PK | — | Unique race identifier from the API (e.g. `RAZZAFRAG03`) |
| `name` | TEXT | `''` | Human-readable display name |
| `type` | TEXT | `''` | Vehicle type: `SHIP`, `SRV`, `ONFOOT`, or `FIGHTER` |
| `version` | TEXT | `''` | Game version: `ODYSSEY` or `HRZ` (normalised from API's `ODY`/`HRZ`) |
| `system` | TEXT | `''` | Star system name |
| `station` | TEXT | `''` | Station/settlement/orbital name (may be empty) |
| `address` | TEXT | `''` | Additional location address/description (may be empty) |
| `sort` | TEXT | `''` | Sort key used for list ordering: `{TYPE}_{name}` |
| `coords` | TEXT | `''` | Galactic XYZ coordinates as `"x,y,z"` |
| `creator` | TEXT | `''` | Race creator name extracted from the race key (e.g. `ALEXFIGHTER` from `ALEXFIGHTER-DW3 Motordrome`). Empty if no pattern match. Matches a known commander ~95% of the time |
| `created_at` | TEXT | `''` | UTC datetime when this row was first inserted (`%Y-%m-%d %H:%M:%S.%f`) |
| `description` | TEXT | `''` | Plain-text race description from `getTTData` |
| `num_checkpoints` | INTEGER | `0` | Number of waypoint checkpoints, derived from `getTTData`. `0` means details not yet fetched |
| `multi_planet` | BOOLEAN | `0` | `1` if the race spans more than one celestial body |
| `multi_system` | BOOLEAN | `0` | `1` if the race spans more than one star system |
| `multi_mode` | BOOLEAN | `0` | `1` if the race requires more than one base vehicle type (e.g. Ship + SRV biathlon) |

> Rows whose name contains `"superseded"` or `"do not use"` (case-insensitive) are deleted on import.

---

### `constraints`

Per-race vehicle/equipment constraints. Many rows per `locations` row.

| Column | Type | Default | Description |
|---|---|---|---|
| `location` | TEXT FK → `locations.key` | — | Race key |
| `key` | TEXT | — | Constraint name (e.g. `Hull`, `Speed`, `MaxSRVPips`) |
| `value` | INTEGER | — | Constraint value. `MaxSRVPips` is stored doubled (e.g. `4` = 2 pips) |

**Primary key:** `(location, key)`. Cascade-deletes when the parent `locations` row is removed. All constraints for a race are deleted and reinserted on each `getTTList` import.

---

### `results`

Individual time trial submissions. At most **2 rows** are kept per `(name, location)` pair — the two most recent by `updated` — to enable improvement tracking while keeping the table lean.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | INTEGER PK | autoincrement | Row ID |
| `name` | TEXT | — | Commander name (e.g. `"CMDR Razz"`) |
| `ship` | TEXT | `''` | Ship/vehicle type abbreviation (e.g. `"SRV"`, `"Cobra MkIII"`) |
| `shipname` | TEXT | `''` | Player-assigned ship name (may be empty) |
| `location` | TEXT FK → `locations.key` | — | Race key |
| `time` | INTEGER | — | Elapsed time in milliseconds |
| `updated` | TEXT | — | UTC datetime of the submission (`%Y-%m-%d %H:%M:%S.%f`) |

**Unique constraint:** `(name, location, updated)` — duplicate submissions are silently ignored (`ON CONFLICT IGNORE`).

---

### `position_snapshots`

Historical record of each commander's leaderboard position at every detected change. Used to compute rival/rivalry data (P1 switches in the last day/week).

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Row ID (autoincrement) |
| `location` | TEXT | Race key |
| `name` | TEXT | Commander name |
| `position` | INTEGER | Leaderboard position at snapshot time (1 = first) |
| `time_ms` | INTEGER | Best time in milliseconds at snapshot time |
| `snapped_at` | TEXT | UTC datetime of the snapshot (`%Y-%m-%d %H:%M:%S.%f`) |

A new snapshot row is only written when a commander's position or time has changed since their last snapshot. Rows older than **90 days** are purged on application startup.

**Indexes:** `(location, name)`, `(snapped_at)`.

---

### `last_updated_cache`

Key-value store for two purposes:

1. **Poll cache** — tracks the API's `getTTResultsLU` timestamps so only changed races are re-fetched.
2. **Migration flags** — one-time migration sentinels stored with a fixed key (e.g. `migration_multi_mode_v1`).

| Column | Type | Description |
|---|---|---|
| `key` | TEXT PK | Race key *or* migration sentinel name |
| `updated` | TEXT | Last-updated datetime string from the API, or `'done'` for migration flags |

---

## Relationships

```
locations  ──< constraints        (location → locations.key, CASCADE DELETE)
locations  ──< results            (location → locations.key, CASCADE DELETE)
```

`position_snapshots` and `last_updated_cache` do not use declared foreign keys.
