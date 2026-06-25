"""
Quick diagnostic for the daynight_bulk_cache table.

Usage:
    .venv/bin/python3 sandpit/check_daynight_bulk.py           # summary
    .venv/bin/python3 sandpit/check_daynight_bulk.py RAZZAFRAG03  # single race
"""

import json
import sqlite3
import sys
from datetime import datetime, timezone

DB = "leaderboard.sqlite3"
con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row


def ago(ts: str | None) -> str:
    if not ts:
        return "—"
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        secs = int((datetime.now(timezone.utc) - dt).total_seconds())
        if secs < 60:
            return f"{secs}s ago"
        if secs < 3600:
            return f"{secs // 60}m ago"
        if secs < 86400:
            return f"{secs // 3600}h {(secs % 3600) // 60}m ago"
        return f"{secs // 86400}d ago"
    except ValueError:
        return ts


def current_state(row) -> str:
    """Apply the same algorithm as the frontend to get the live state."""
    now = datetime.now(timezone.utc)

    def parse(ts):
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return None

    until = parse(row["until_utc"])
    if until is None or now < until:
        return row["state"]

    for iv in json.loads(row["upcoming_intervals"] or "[]"):
        iv_from = parse(iv.get("from"))
        iv_until = parse(iv.get("until"))
        if iv_from and iv_until and iv_from <= now < iv_until:
            return iv["state"]

    return "unknown (all intervals expired)"


# ── Single race ───────────────────────────────────────────────────────────────
if len(sys.argv) > 1:
    key = sys.argv[1]
    row = con.execute("SELECT * FROM daynight_bulk_cache WHERE race_key = ?", (key,)).fetchone()
    if not row:
        print(f"Race key '{key}' not found in daynight_bulk_cache.")
        sys.exit(1)

    intervals = json.loads(row["upcoming_intervals"] or "[]")
    print(f"Race key  : {row['race_key']}")
    print(f"Fetched   : {row['fetched_at']}  ({ago(row['fetched_at'])})")
    print(f"Stored state : {row['state']}")
    print(f"Until        : {row['until_utc'] or '(permanent)'}")
    print(f"Live state   : {current_state(row)}")
    print(f"Intervals    : {len(intervals)}")
    for iv in intervals:
        print(f"  {iv.get('state'):5}  {iv.get('from')} → {iv.get('until')}")
    sys.exit(0)


# ── Summary ───────────────────────────────────────────────────────────────────
summary = con.execute(
    "SELECT MAX(fetched_at) AS last_fetched, MIN(fetched_at) AS first_in_batch, COUNT(*) AS total FROM daynight_bulk_cache"
).fetchone()

print("── daynight_bulk_cache ──────────────────────────")
print(f"Races stored : {summary['total']}")
print(f"Last fetched : {summary['last_fetched']}  ({ago(summary['last_fetched'])})")

rows = con.execute("SELECT * FROM daynight_bulk_cache").fetchall()
live_states = {}
for r in rows:
    s = current_state(r)
    live_states[s] = live_states.get(s, 0) + 1

print("\nLive state breakdown (computed now):")
for state, count in sorted(live_states.items()):
    print(f"  {state:8} {count}")

stale = [
    r
    for r in rows
    if r["until_utc"]
    and datetime.fromisoformat(r["until_utc"].replace("Z", "+00:00")) < datetime.now(timezone.utc)
    and not json.loads(r["upcoming_intervals"] or "[]")
]
if stale:
    print(f"\n⚠  {len(stale)} race(s) have an expired 'until' and no upcoming intervals:")
    for r in stale:
        print(f"  {r['race_key']}")
else:
    print("\nAll races have a valid current state.")

con.close()
