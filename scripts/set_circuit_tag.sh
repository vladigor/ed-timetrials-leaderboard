#!/bin/bash
set -euo pipefail

DB_PATH="${1:-leaderboard.sqlite3}"
RACES_FILE="${2:-circuit_races.txt}"
DRY_RUN="${3:-0}"

.venv/bin/python3 - "$DB_PATH" "$RACES_FILE" "$DRY_RUN" <<'PY'
import sqlite3
import sys
from pathlib import Path

db_path = sys.argv[1]
races_file = sys.argv[2]
dry_run = sys.argv[3] == "1"

names = [line.strip() for line in Path(races_file).read_text(encoding="utf-8").splitlines() if line.strip()]

con = sqlite3.connect(db_path)
cur = con.cursor()

matched = 0
updated = 0
already_tagged = 0
unmatched = []

for name in names:
    row = cur.execute(
        "SELECT key, tags FROM locations WHERE name = ? COLLATE NOCASE",
        (name,),
    ).fetchone()

    if not row:
        unmatched.append(name)
        continue

    matched += 1
    key, tags = row
    parts = [p.strip() for p in (tags or "").split(",") if p.strip()]

    if "Circuit" in parts:
        already_tagged += 1
        continue

    parts.append("Circuit")
    if not dry_run:
        cur.execute("UPDATE locations SET tags = ? WHERE key = ?", (", ".join(parts), key))
    updated += 1

if not dry_run:
    con.commit()

print(
    f"listed={len(names)} matched={matched} updated={updated} "
    f"already_tagged={already_tagged} unmatched={len(unmatched)} dry_run={int(dry_run)}"
)

if unmatched:
    print("UNMATCHED:")
    for name in unmatched:
        print(name)

con.close()
PY
