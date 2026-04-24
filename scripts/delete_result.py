#!/usr/bin/env python3
"""
Delete race result entries from the leaderboard database.

Usage:
    python delete_result.py --commander "FREEFIY" --race "ALEC TURNER-syrenthis_verge_descent"
    python delete_result.py --commander "CMDR Name" --race "RACE-KEY" --time 22744
    python delete_result.py --commander "CMDR Name" --race "RACE-KEY" --ship "SRV Scarab"
    python delete_result.py --id 12345
"""

import argparse
import asyncio
import sqlite3
from pathlib import Path


def format_time_ms(ms: int) -> str:
    """Format milliseconds as MM:SS.mmm"""
    minutes = ms // 60000
    seconds = (ms % 60000) / 1000
    return f"{minutes}:{seconds:06.3f}"


async def main():
    parser = argparse.ArgumentParser(description="Delete race result entries from the database")
    parser.add_argument("--commander", "-c", help="Commander name (case-insensitive)")
    parser.add_argument("--race", "-r", help="Race key (location)")
    parser.add_argument(
        "--time", "-t", type=int, help="Time in milliseconds (optional, for additional filtering)"
    )
    parser.add_argument(
        "--ship", "-s", help="Ship/vehicle type (optional, for additional filtering)"
    )
    parser.add_argument("--id", type=int, help="Delete by result ID directly")
    parser.add_argument("--force", "-f", action="store_true", help="Skip confirmation prompt")
    parser.add_argument(
        "--db", default="leaderboard.sqlite3", help="Database path (default: leaderboard.sqlite3)"
    )

    args = parser.parse_args()

    # Validate arguments
    if args.id:
        if any([args.commander, args.race, args.time, args.ship]):
            parser.error("--id cannot be combined with other filters")
    elif not (args.commander and args.race):
        parser.error("Either --id or both --commander and --race are required")

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
        return 1

    # Connect to database
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Build query to find matching results
        if args.id:
            query = "SELECT * FROM results WHERE id = ?"
            params = [args.id]
        else:
            query = "SELECT * FROM results WHERE LOWER(name) = LOWER(?) AND location = ?"
            params = [args.commander, args.race]

            if args.time:
                query += " AND time = ?"
                params.append(args.time)

            if args.ship:
                query += " AND ship = ?"
                params.append(args.ship)

        # Find matching results
        cursor.execute(query, params)
        results = cursor.fetchall()

        if not results:
            print("No matching results found.")
            return 0

        # Display results to be deleted
        print(f"\nFound {len(results)} result(s) to delete:\n")
        for row in results:
            print(f"  ID:        {row['id']}")
            print(f"  Commander: {row['name']}")
            print(f"  Race:      {row['location']}")
            print(f"  Time:      {format_time_ms(row['time'])} ({row['time']} ms)")
            print(f"  Vehicle:   {row['ship']}")
            if row["shipname"]:
                print(f"  Ship Name: {row['shipname']}")
            print(f"  Updated:   {row['updated']}")
            print()

        # Confirm deletion
        if not args.force:
            response = input("Delete these result(s)? [y/N]: ")
            if response.lower() not in ("y", "yes"):
                print("Cancelled.")
                return 0

        # Delete the results
        ids = [row["id"] for row in results]
        placeholders = ",".join("?" * len(ids))
        delete_query = f"DELETE FROM results WHERE id IN ({placeholders})"
        cursor.execute(delete_query, ids)
        conn.commit()

        print(f"\n✓ Deleted {len(results)} result(s).")

        # Show remaining results for this commander/race (if applicable)
        if not args.id and args.commander and args.race:
            cursor.execute(
                "SELECT * FROM results WHERE LOWER(name) = LOWER(?) AND location = ? ORDER BY time",
                [args.commander, args.race],
            )
            remaining = cursor.fetchall()
            if remaining:
                print(f"\nRemaining results for {args.commander} in {args.race}:")
                for row in remaining:
                    print(f"  {format_time_ms(row['time'])} - {row['ship']} (ID: {row['id']})")
            else:
                print(f"\nNo remaining results for {args.commander} in {args.race}.")

        return 0

    finally:
        conn.close()


if __name__ == "__main__":
    exit(asyncio.run(main()))
