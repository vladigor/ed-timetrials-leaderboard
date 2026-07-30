#!/usr/bin/env python3
"""Generic race tag management for leaderboard.sqlite3.

Usage examples:
  scripts/set_tag.py --tag Remote --key "ALICE KNIGHT-BEAGLE01"
  scripts/set_tag.py --tag Circuit --names-file circuit_races.txt
  scripts/set_tag.py --tag DW3 --name-like "DW3%" --name-like "The Distant Worlds 3%"
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add a tag to matching races in the locations table."
    )
    parser.add_argument("--db", default="leaderboard.sqlite3", help="Path to SQLite database")
    parser.add_argument(
        "--tag", required=True, help="Tag to add (for example: DW3, Circuit, Remote)"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Show what would change, but do not update"
    )

    parser.add_argument(
        "--key",
        action="append",
        default=[],
        help="Race key to match exactly (can be provided multiple times)",
    )
    parser.add_argument(
        "--name",
        action="append",
        default=[],
        help="Race name to match exactly, case-insensitive (can be provided multiple times)",
    )
    parser.add_argument(
        "--name-like",
        action="append",
        default=[],
        help="SQL LIKE pattern for race names, case-insensitive (can be provided multiple times)",
    )
    parser.add_argument(
        "--keys-file",
        help="Text file with one race key per line",
    )
    parser.add_argument(
        "--names-file",
        help="Text file with one race name per line",
    )

    args = parser.parse_args()

    if not any([args.key, args.name, args.name_like, args.keys_file, args.names_file]):
        parser.error(
            "Provide at least one selector: --key/--name/--name-like/--keys-file/--names-file"
        )

    args.tag = args.tag.strip()
    if not args.tag:
        parser.error("--tag cannot be empty")

    return args


def read_lines(path: str | None) -> list[str]:
    if not path:
        return []
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {p}")
    return [line.strip() for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


def parse_tags(raw: str | None) -> list[str]:
    return [part.strip() for part in (raw or "").split(",") if part.strip()]


def main() -> int:
    args = parse_args()

    keys = list(args.key)
    keys.extend(read_lines(args.keys_file))

    names = list(args.name)
    names.extend(read_lines(args.names_file))

    like_patterns = list(args.name_like)

    con = sqlite3.connect(args.db)
    cur = con.cursor()

    # Ordered dict behavior via plain dict in 3.7+ keeps first-seen order.
    matches: dict[str, tuple[str, str | None]] = {}

    for key in keys:
        row = cur.execute("SELECT key, name, tags FROM locations WHERE key = ?", (key,)).fetchone()
        if row:
            matches[row[0]] = (row[1], row[2])

    for name in names:
        for row in cur.execute(
            "SELECT key, name, tags FROM locations WHERE name = ? COLLATE NOCASE", (name,)
        ).fetchall():
            matches[row[0]] = (row[1], row[2])

    for pattern in like_patterns:
        for row in cur.execute(
            "SELECT key, name, tags FROM locations WHERE name LIKE ? COLLATE NOCASE", (pattern,)
        ).fetchall():
            matches[row[0]] = (row[1], row[2])

    requested = len(keys) + len(names) + len(like_patterns)

    updated = 0
    already_tagged = 0

    for key, (_name, raw_tags) in matches.items():
        parts = parse_tags(raw_tags)
        if args.tag in parts:
            already_tagged += 1
            continue
        parts.append(args.tag)
        if not args.dry_run:
            cur.execute("UPDATE locations SET tags = ? WHERE key = ?", (", ".join(parts), key))
        updated += 1

    if not args.dry_run:
        con.commit()

    print(
        f"selectors={requested} matched={len(matches)} updated={updated} "
        f"already_tagged={already_tagged} dry_run={int(args.dry_run)}"
    )

    con.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc
