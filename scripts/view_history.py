#!/usr/bin/env python3
"""View recent entries from results_history table."""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path so we can import from app/
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import get_db


def format_time(ms: int) -> str:
    """Format milliseconds as MM:SS.mmm."""
    total_seconds = ms / 1000
    minutes = int(total_seconds // 60)
    seconds = total_seconds % 60
    return f"{minutes:02d}:{seconds:06.3f}"


async def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10

    db = await get_db()
    try:
        async with db.execute(
            """
            SELECT
                rh.name,
                rh.location,
                l.name AS race_name,
                rh.time,
                rh.ship,
                rh.updated,
                rh.position
            FROM results_history rh
            LEFT JOIN locations l ON l.key = rh.location
            ORDER BY rh.updated DESC
            LIMIT ?
            """,
            (limit,),
        ) as cur:
            rows = await cur.fetchall()

            if not rows:
                print("No results found in history table.")
                return

            print(
                f"\n{'Commander':<25} {'Race':<30} {'Pos':<5} {'Time':<12} {'Ship':<20} {'Updated':<19}"
            )
            print("=" * 113)

            for row in rows:
                cmdr = row["name"][:24]
                race = (row["race_name"] or row["location"])[:29]
                pos = str(row["position"]) if row["position"] else "-"
                time_str = format_time(row["time"])
                ship = (row["ship"] or "")[:19]
                # Remove microseconds - keep only YYYY-MM-DD HH:MM:SS
                updated = row["updated"][:19] if row["updated"] else ""

                print(f"{cmdr:<25} {race:<30} {pos:<5} {time_str:<12} {ship:<20} {updated:<19}")

            print(f"\nShowing {len(rows)} most recent entries.")

    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
