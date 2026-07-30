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
import sqlite3
from pathlib import Path


def format_time_ms(ms: int) -> str:
    """Format milliseconds as MM:SS.mmm"""
    minutes = ms // 60000
    seconds = (ms % 60000) / 1000
    return f"{minutes}:{seconds:06.3f}"


def main():
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

    # Check permissions
    if not db_path.parent.is_dir():
        print(f"Error: Parent directory does not exist: {db_path.parent}")
        return 1

    if not db_path.parent.stat().st_mode & 0o200:  # Check write permission on directory
        print(f"Error: No write permission on directory: {db_path.parent}")
        print("Hint: SQLite needs write access to the directory for WAL/journal files")
        return 1

    if not db_path.stat().st_mode & 0o200:  # Check write permission on file
        print(f"Error: No write permission on database file: {db_path}")
        print(f"Run: chmod u+w {db_path}")
        return 1

    # Connect to database
    try:
        conn = sqlite3.connect(db_path)
    except sqlite3.OperationalError as e:
        print(f"Error: Cannot open database: {e}")
        print(f"\nDatabase: {db_path}")
        print(f"Permissions: {oct(db_path.stat().st_mode)[-3:]}")
        print(f"Owner: {db_path.stat().st_uid}")
        print(f"Current user: {Path.cwd()}")
        return 1

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

        try:
            cursor.execute(delete_query, ids)
            conn.commit()
        except sqlite3.OperationalError as e:
            print(f"\n✗ Error deleting results: {e}")
            print("\nPossible causes:")
            print("  - Database file is readonly")
            print("  - Another process has the database locked")
            print("  - Insufficient permissions")
            print("\nTo fix:")
            print(f"  1. Check file permissions: ls -la {db_path}")
            print(f"  2. Check directory permissions: ls -la {db_path.parent}")
            print("  3. Stop any services using the database (e.g., systemctl stop tt-leaderboard)")
            print(f"  4. Ensure you have write access: chmod u+w {db_path}")
            return 1

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
    exit(main())
