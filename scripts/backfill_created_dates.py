#!/usr/bin/env python3
"""Backfill locations.created_at for races that pre-date this application.

The created date is inferred from the oldest submission found in results or
results_history for each race. It is an approximation only.

Usage (from the repo root):
    # Compute inferred dates from the local DB and write them to a JSON file
    python scripts/backfill_created_dates.py export

    # Apply the JSON file to the DB (only fills races with an empty created_at)
    python scripts/backfill_created_dates.py import --dry-run
    python scripts/backfill_created_dates.py import
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "leaderboard.sqlite3"
DEFAULT_FILE = ROOT / "inferred_created_dates.json"


def export_dates(con: sqlite3.Connection, path: Path) -> None:
    rows = con.execute(
        """
        SELECT l.key, MIN(s.updated)
        FROM locations l
        JOIN (
            SELECT location, updated FROM results
            UNION ALL
            SELECT location, updated FROM results_history
        ) s ON s.location = l.key
        WHERE l.created_at = ''
        GROUP BY l.key
        ORDER BY l.key
        """
    ).fetchall()
    data = {key: updated for key, updated in rows if updated}
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    missing = con.execute("SELECT COUNT(*) FROM locations WHERE created_at = ''").fetchone()[0]
    print(
        f"Wrote {len(data)} inferred dates to {path} ({missing - len(data)} races had no submissions)"
    )


def import_dates(con: sqlite3.Connection, path: Path, dry_run: bool) -> None:
    data: dict[str, str] = json.loads(path.read_text(encoding="utf-8"))
    updated = skipped = unknown = 0
    with con:
        for key, created_at in data.items():
            row = con.execute("SELECT created_at FROM locations WHERE key = ?", (key,)).fetchone()
            if row is None:
                unknown += 1
                continue
            if row[0]:
                skipped += 1
                continue
            print(f"  {key}: {created_at}")
            if not dry_run:
                con.execute(
                    "UPDATE locations SET created_at = ? WHERE key = ? AND created_at = ''",
                    (created_at, key),
                )
            updated += 1
    prefix = "[dry run] Would update" if dry_run else "Updated"
    print(f"{prefix} {updated} races; {skipped} already had a date; {unknown} not found in DB")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("action", choices=["export", "import"])
    parser.add_argument(
        "--file", type=Path, default=DEFAULT_FILE, help=f"JSON file (default: {DEFAULT_FILE.name})"
    )
    parser.add_argument("--db", type=Path, default=DB_PATH, help="SQLite database path")
    parser.add_argument(
        "--dry-run", action="store_true", help="Import only: show changes without writing"
    )
    args = parser.parse_args()

    if not args.db.exists():
        sys.exit(f"Database not found: {args.db}")
    if args.action == "import" and not args.file.exists():
        sys.exit(f"File not found: {args.file}")

    con = sqlite3.connect(args.db)
    try:
        if args.action == "export":
            export_dates(con, args.file)
        else:
            import_dates(con, args.file, args.dry_run)
    finally:
        con.close()


if __name__ == "__main__":
    main()
