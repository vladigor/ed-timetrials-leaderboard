#!/bin/bash
set -euo pipefail

DB_PATH="${1:-leaderboard.sqlite3}"
RACES_FILE="${2:-circuit_races.txt}"
DRY_RUN="${3:-0}"

DRY_FLAG=""
if [[ "$DRY_RUN" == "1" ]]; then
  DRY_FLAG="--dry-run"
fi

.venv/bin/python3 scripts/set_tag.py --db "$DB_PATH" --tag Circuit --names-file "$RACES_FILE" $DRY_FLAG
