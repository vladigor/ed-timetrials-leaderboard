#!/bin/bash
set -euo pipefail

DB_PATH="${1:-leaderboard.sqlite3}"
DRY_RUN="${2:-0}"

DRY_FLAG=""
if [[ "$DRY_RUN" == "1" ]]; then
	DRY_FLAG="--dry-run"
fi

.venv/bin/python3 scripts/set_tag.py \
	--db "$DB_PATH" \
	--tag DW3 \
	--name-like "DW3%" \
	--name-like "The Distant Worlds 3%" \
	--name-like "The DW3%" \
	--name "Khazad-dum Base Camp Biathlon" \
	$DRY_FLAG
