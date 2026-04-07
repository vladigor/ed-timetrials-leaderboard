# Elite Dangerous Time Trials Leaderboard

A web application that displays Elite Dangerous Time Trials leaderboards, pulling live data from the upstream API and caching it in a local SQLite database.

## Tech stack

| Layer | Choice |
|---|---|
| Language | Python 3.11+ |
| Web framework | FastAPI + Jinja2 |
| ASGI server | Uvicorn |
| Database | SQLite via aiosqlite |
| HTTP client | httpx (async) |
| Background scheduler | APScheduler |
| Frontend | Vanilla JS (ES modules) + CSS |

## Features

- **Race index** — card grid of all time trials with filters for active races, commander, and vehicle type. Each card shows the race type badge, entry count, and (if a commander is set) their current position.
- **Race detail page** — ranked results table with a scaled horizontal bar chart (Apache ECharts) showing finish times to scale. Highlights the selected commander's row.
- **Commander page** — ranked table of a commander's results across all races, grouped by vehicle type. Includes percentile ranking per race and a time-improvement column. Sortable by percentile or most recent.
- **Opportunities section** — enter your current star system to find nearby races worth your attention:
  - *Improvement Opportunities* — races you've already competed in, ranked by catchability score based on proximity to the positions above you and how many places a single 10% improvement would gain.
  - *Not Done Yet* — nearby races you haven't entered, sorted by distance. Both tabs support Type and Distance filters.
- **Trophy Case** — gold/silver/bronze medal counts at a glance on the commander page.
- **Live updates** — the browser polls every 60 s and refreshes automatically when new data is detected. The race page also refreshes on tab focus.
- **SQLite caching** — stores the latest two result rows per commander per race, with incremental updates on change detection.
- **Superseded race filtering** — races marked as superseded or "do not use" in the upstream data are automatically excluded.
- **Cache busting** — static assets include a restart-time version query string to prevent stale browser caches.

## Running locally

```bash
cd timetrials-leaderboard
bash run.sh
```

Then open http://localhost:8090 in your browser.

### Offline mode

To run without making any outbound API calls (serves from the local SQLite cache only):

```bash
OFFLINE=1 bash run.sh
```

The status indicator in the UI will show "Offline — local data" instead of the live polling dot.

## Running as a systemd service

```bash
cp tt-leaderboard.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tt-leaderboard
```

To deploy updates:

```bash
git pull && sudo systemctl restart tt-leaderboard
```
