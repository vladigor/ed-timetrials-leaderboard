# Elite Dangerous Time Trials Leaderboard — Copilot Instructions

## Project Overview

A self-hosted leaderboard application for the Elite Dangerous time-trial community. It syncs race and result data from an external API (EDCoPilot), stores it in a local SQLite database, and serves a responsive single-page web UI.

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3, FastAPI, `aiosqlite`, `httpx`, `apscheduler` |
| Frontend | Vanilla JS (ES modules), Jinja2 templates, plain CSS |
| Database | SQLite (WAL mode, `leaderboard.sqlite3`) |
| Runtime | Deployed as a `systemd` service (`tt-leaderboard.service`), launched via `run.sh` |

## Repository Layout

```
app/
  config.py       # Reads env vars (OFFLINE flag)
  database.py     # Schema creation, migrations, get_db()
  importer.py     # Fetches from EDCoPilot API → writes to DB
  queries.py      # All DB read logic (list_races, get_race, get_commander_stats, …)
  scheduler.py    # APScheduler background poll (60 s interval)
  main.py         # FastAPI app, routes, API endpoints
documentation/
  timetrials-api.md     # EDCoPilot external API reference
  database-schema.md    # SQLite table definitions and column notes
static/js/
  index.js        # Race list page logic
  race.js         # Individual race page logic
  cmdr.js         # Commander stats page logic
  poller.js       # ChangePoller — long-poll helper used by all pages
  utils.js        # Shared formatting helpers (formatTime, esc, relativeTime, …)
templates/
  index.html / race.html / cmdr.html / about.html
```

## Architecture Notes

- **Data flow:** On startup, `full_refresh()` in `scheduler.py` calls `fetch_and_store_locations()`, then `fetch_and_store_race_details()` (for any races missing waypoint data), then fetches results for all changed races. The APScheduler then repeats this every 60 seconds using `getTTResultsLU` to detect which races changed.
- **Results retention:** Only the 2 most recent result rows per `(commander, race)` are kept, enabling improvement/delta tracking without unbounded growth.
- **Offline mode:** Set `OFFLINE=1` in the environment to disable all outbound API calls and serve exclusively from the local DB.
- **Frontend polling:** The JS `ChangePoller` class polls `/api/poll` every 60 s and triggers a page re-render only if the relevant race's timestamp changed.
- **Static asset versioning:** A timestamp-based `v` query parameter is injected into all static asset URLs by the Jinja2 templates to bust caches on restart.

## API Endpoints (internal)

| Method | Path | Description |
|---|---|---|
| GET | `/api/races` | List races. Supports `active_days`, `commander`, `commander_pos` query params |
| GET | `/api/races/new` | Races added within last N days (`days` param, default 7) |
| GET | `/api/races/{key}` | Single race with ranked results and rivalry data |
| GET | `/api/commanders` | Sorted list of all known commander names |
| GET | `/api/cmdr/{name}` | Commander stats with per-race positions and percentiles |
| GET | `/api/poll` | Last-updated snapshot used by frontend long-poll |
| GET | `/api/system-coords` | Proxy to EDSM — resolves a system name to XYZ coords |
| GET | `/api/system-suggest` | Proxy to Spansh — autocomplete for system names |

## Hosting & Deployment

| | |
|---|---|
| **Live URL** | https://elitettleaderboard.vladigor.net |
| **GitHub repo** | https://github.com/vladigor/ed-timetrials-leaderboard |
| **Runtime** | Proxmox LXC container |
| **Reverse proxy** | nginx (handles static caching) in front of uvicorn on port 8090 |
| **External access** | Cloudflare Tunnel — no direct inbound ports exposed |
| **Process manager** | systemd service (`tt-leaderboard.service`) |
| **Deploy process** | `git pull` on the live container, then `sudo systemctl restart tt-leaderboard` |

- Development is done on a **separate local dev server** (not the Proxmox host).
- **Both dev and production** run as systemd services — use `sudo systemctl restart tt-leaderboard` to restart either environment.
- `run.sh` can manually set up the virtualenv and start uvicorn directly, but is typically not needed when using systemd.
- **Important:** Changes to `.env` require a restart to take effect — config values are read once at import time, not dynamically.
- Never restart the production service unless explicitly asked; suggest the command instead.

## Coding Conventions

- **Python:** `async`/`await` throughout. Always call `await db.close()` in a `finally` block — use the `get_db()` helper, not raw `aiosqlite.connect()`. No ORM; raw SQL only.
- **JavaScript:** ES modules (`import`/`export`). No build step, no frameworks. Always escape user-controlled strings using the `esc()` helper from `utils.js` before inserting into `innerHTML`.
- **Migrations:** Add new columns via `ALTER TABLE` inside `init_db()` in `database.py`, wrapped in `try/except` to tolerate existing columns. Schema-breaking changes go through a named migration sentinel in `last_updated_cache`.
- **No TypeScript, no bundler, no test suite** currently in use.

## Working with Terminals (Agent Mode)

- **IMPORTANT:** The `run_in_terminal` tool does NOT return command output directly
- To see terminal output after running a command, either:
  1. Redirect output to a file (`> /tmp/output.txt 2>&1`) then read the file with `read_file`
  2. Use `terminal_last_command` (note: may not always capture full output)
- The proper workflow is: 1) `run_in_terminal` with output redirect 2) `read_file` to see results
- Always run Python scripts using `.venv/bin/python3` to use the project's virtual environment

## Reference Documentation

- **External API details** (endpoints, request/response formats, field indexes): see `documentation/timetrials-api.md`
- **Database schema** (all tables, columns, types, constraints, relationships): see `documentation/database-schema.md`

When answering questions or making changes that involve how data is fetched from the EDCoPilot API or how the database is structured, **read those two files first** before suggesting or generating code.
