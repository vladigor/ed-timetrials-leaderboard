#!/usr/bin/env bash
# run.sh — start the Elite TT Leaderboard web app
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Recreate virtual environment if it looks stale (e.g. after moving the directory)
if [ ! -f .venv/bin/python3 ] || [ ! -f .venv/bin/activate ]; then
  echo "Creating Python virtual environment…"
  rm -rf .venv
  python3 -m venv .venv
fi

source .venv/bin/activate

# Load environment variables from .env file if it exists
if [ -f .env ]; then
  set -a  # automatically export all variables
  source .env
  set +a
fi

# Install / update dependencies
python3 -m pip install -q -r requirements.txt

# Uncomment the next line to disable all outbound API calls (serves from local DB only)
# export OFFLINE=1

# Start the app
exec uvicorn app.main:app --host 0.0.0.0 --port 8090 "$@"
