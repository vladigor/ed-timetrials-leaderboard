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
from urllib.parse import unquote


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add a tag to matching races in the locations table."
    )
    parser.add_argument("--db", default="leaderboard.sqlite3", help="Path to SQLite database")
    parser.add_argument(
        "--tag",
        action="append",
        required=True,
        help=(
            "Tag to add (for example: DW3, Circuit, Remote). "
            "Can be provided multiple times and supports comma-separated values."
        ),
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

    tags: list[str] = []
    seen: set[str] = set()
    for raw in args.tag:
        for part in (raw or "").split(","):
            tag = part.strip()
            if not tag or tag in seen:
                continue
            seen.add(tag)
            tags.append(tag)

    if not tags:
        parser.error("--tag cannot be empty")

    args.tag = tags

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


def decode_selector_values(values: list[str]) -> list[str]:
    return [unquote(value) for value in values]


def main() -> int:
    args = parse_args()

    keys = decode_selector_values(list(args.key))
    keys.extend(read_lines(args.keys_file))
    keys = decode_selector_values(keys)

    names = decode_selector_values(list(args.name))
    names.extend(read_lines(args.names_file))
    names = decode_selector_values(names)

    like_patterns = decode_selector_values(list(args.name_like))

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
    tags_added = 0
    already_tagged = 0

    for key, (_name, raw_tags) in matches.items():
        parts = parse_tags(raw_tags)
        changed = False
        for tag in args.tag:
            if tag in parts:
                continue
            parts.append(tag)
            tags_added += 1
            changed = True

        if not changed:
            already_tagged += 1
            continue

        if not args.dry_run:
            cur.execute("UPDATE locations SET tags = ? WHERE key = ?", (", ".join(parts), key))
        updated += 1

    if not args.dry_run:
        con.commit()

    print(
        f"selectors={requested} matched={len(matches)} updated={updated} tags_added={tags_added} "
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
