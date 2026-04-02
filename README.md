# Elite Dangerous Time Trial Leaderboard

A web application that displays Elite Dangerous time trial leaderboards, pulling live data from the Razzafarag API and caching it in a local SQLite database.

## Tech stack

| Layer | Choice |
|---|---|
| Language | Python 3.11+ |
| Web framework | FastAPI |
| ASGI server | Uvicorn |
| Database | SQLite via aiosqlite |
| HTTP client | httpx (async) |
| Background scheduler | APScheduler |
| Frontend | Vanilla JS (ES modules) + CSS |

## Features

- **Index page** — card grid of all time trials with commander and "active in last 7 days" filters.
- **Race detail page** — ranked results table with a scaled horizontal bar chart showing each commander's finish time to scale.
- **Live updates** — the browser polls `/api/poll` every 60 s and refreshes automatically when the API reports changed data.  The race page also refreshes when the browser tab regains focus.
- **SQLite caching** — the app stores the latest two result rows per commander per race, matching Razzafarag's data model.

## API endpoints consumed

| Method | URL | Description |
|---|---|---|
| GET | `https://razzserver.com/razapis/getTTList/LEADERBOARD` | List of all time trial locations |
| GET | `https://razzserver.com/razapis/getTTResults/LEADERBOARD<\|>{key}` | Results for one TT |
| GET | `https://razzserver.com/razapis/getTTResultsLU/LEADERBOARD` | Last-updated timestamps (used for change detection) |

## Running locally

```bash
cd tt-leaderboard
bash run.sh
```

Then open http://localhost:8080 in your browser.

## Running as a systemd service (Proxmox LXC / VM)

```bash
# Install dependencies once
cd tt-leaderboard
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Copy and enable the service unit
cp tt-leaderboard.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tt-leaderboard
```

## Future enhancements

- **Commander page** — shows a specific commander's entries across all races, displaying their absolute rank and _percentile_ rank per race, sorted by percentile so they can see which races to focus on improving next.
