#!/usr/bin/env python3
"""Rename a commander (and optionally their creator entries) across the database.

Usage (from the repo root):
    python scripts/rename_commander.py --old NKIRSE --new NASTYNATE1

Because the new name may already have results in the DB, the script:
  1. Drops any NKIRSE rows in results/results_history that are exact
     duplicates of an existing NASTYNATE1 row (same location + updated).
  2. Renames all remaining NKIRSE rows to NASTYNATE1.
  3. Re-prunes the results table so NASTYNATE1 still has at most 2 rows
     per race (the merge may push some races over the limit).
  4. Updates locations.creator where the race was created by the old name.
  5. Deletes the inara_cache entry for the old name so it is re-fetched.

All changes run inside a single transaction and are rolled back on error.

NOTE: The `creator` column in `locations` is re-derived from the race key on every
import (via `_extract_creator` in importer.py). If the old name appears in any race
keys, you must also add an entry to `_CREATOR_ALIASES` in importer.py so the importer
maps the old name to the new one on every subsequent sync.
"""

import argparse
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "leaderboard.sqlite3"


def preview(con: sqlite3.Connection, old: str, new: str) -> dict:
    cur = con.cursor()
    counts = {}
    for tbl, col in [
        ("results", "name"),
        ("results_history", "name"),
        ("position_snapshots", "name"),
        ("locations", "creator"),
        ("inara_cache", "commander_name"),
    ]:
        cur.execute(f"SELECT COUNT(*) FROM {tbl} WHERE {col} = ? COLLATE NOCASE", (old,))
        counts[f"{tbl}.{col}"] = cur.fetchone()[0]

    # Rows that would collide on UNIQUE(name, location, updated)
    for tbl in ("results", "results_history"):
        cur.execute(
            f"""
            SELECT COUNT(*) FROM {tbl} o
            WHERE o.name = ? COLLATE NOCASE
              AND EXISTS (
                  SELECT 1 FROM {tbl} n
                  WHERE n.name = ? COLLATE NOCASE
                    AND n.location = o.location
                    AND n.updated  = o.updated
              )
            """,
            (old, new),
        )
        counts[f"{tbl}.conflicts"] = cur.fetchone()[0]

    return counts


def run_rename(con: sqlite3.Connection, old: str, new: str) -> None:
    # --- Drop exact duplicates that would violate UNIQUE(name, location, updated) ---
    for tbl in ("results", "results_history"):
        con.execute(
            f"""
            DELETE FROM {tbl}
            WHERE name = ? COLLATE NOCASE
              AND EXISTS (
                  SELECT 1 FROM {tbl} n
                  WHERE n.name = ? COLLATE NOCASE
                    AND n.location = {tbl}.location
                    AND n.updated  = {tbl}.updated
              )
            """,
            (old, new),
        )

    # --- Rename across all tables ---
    con.execute("UPDATE results SET name = ? WHERE name = ? COLLATE NOCASE", (new, old))
    con.execute("UPDATE results_history SET name = ? WHERE name = ? COLLATE NOCASE", (new, old))
    con.execute("UPDATE position_snapshots SET name = ? WHERE name = ? COLLATE NOCASE", (new, old))
    con.execute("UPDATE locations SET creator = ? WHERE creator = ? COLLATE NOCASE", (new, old))

    # --- Delete stale inara_cache entry so it is re-fetched on next lookup ---
    con.execute("DELETE FROM inara_cache WHERE commander_name = ? COLLATE NOCASE", (old,))

    # --- Re-prune results: keep only 2 most-recent rows per (name, location) ---
    # Merging old + new rows may push some races over the 2-row limit.
    cur = con.execute("SELECT DISTINCT location FROM results WHERE name = ? COLLATE NOCASE", (new,))
    locations = [row[0] for row in cur.fetchall()]
    for loc in locations:
        con.execute(
            """
            DELETE FROM results
            WHERE name = ? AND location = ?
              AND id NOT IN (
                  SELECT id FROM results
                  WHERE name = ? AND location = ?
                  ORDER BY updated DESC
                  LIMIT 2
              )
            """,
            (new, loc, new, loc),
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Rename a commander in the leaderboard DB")
    parser.add_argument("--old", required=True, help="Current commander name to rename from")
    parser.add_argument("--new", required=True, help="New commander name to rename to")
    parser.add_argument(
        "--db",
        default=str(DB_PATH),
        help=f"Path to the SQLite database (default: {DB_PATH})",
    )
    parser.add_argument("--force", "-f", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"Error: database not found at {db_path}", file=sys.stderr)
        return 1

    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys=ON")
    con.row_factory = sqlite3.Row

    try:
        counts = preview(con, args.old, args.new)

        print(f"\nRenaming '{args.old}' → '{args.new}'\n")
        print("Rows affected:")
        print(f"  results          (name):            {counts['results.name']}")
        print(f"  results_history  (name):            {counts['results_history.name']}")
        print(f"  position_snapshots (name):          {counts['position_snapshots.name']}")
        print(f"  locations        (creator):         {counts['locations.creator']}")
        print(f"  inara_cache      (commander_name):  {counts['inara_cache.commander_name']}")

        if counts["results.conflicts"] or counts["results_history.conflicts"]:
            print(
                f"\n  NOTE: {counts['results.conflicts']} exact duplicate(s) in results "
                f"and {counts['results_history.conflicts']} in results_history "
                "(same location + updated timestamp) will be dropped before renaming."
            )

        print()
        if not args.force:
            ans = input("Proceed? [y/N] ").strip().lower()
            if ans != "y":
                print("Aborted.")
                return 0

        with con:
            run_rename(con, args.old, args.new)

        print("Done.")
        return 0

    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
