# Pre-commit Linting Setup

This project uses [pre-commit](https://pre-commit.com/) to automatically lint and format code before commits.

## What's Included

### Python Linting (Ruff)
- **Linter**: Catches errors, style issues, and anti-patterns
- **Formatter**: Auto-formats code to match project style
- **Config**: `ruff.toml`

### JavaScript Linting (ESLint)
- **Linter**: Enforces code quality and style rules
- **Config**: `eslint.config.js`

### JSON Validation
- Validates JSON syntax in `media.json` and other JSON files

### General File Checks
- Removes trailing whitespace
- Ensures files end with a newline
- Prevents large files from being committed
- Normalizes line endings

## Installation

The pre-commit hooks are already installed in this repository. If you need to reinstall:

```bash
.venv/bin/pre-commit install
```

## Usage

### Automatic (Recommended)
The hooks run automatically on `git commit`. If any issues are found:
- Auto-fixable issues will be corrected automatically
- You'll need to `git add` the fixed files and commit again
- Non-fixable issues will be reported and must be fixed manually

### Manual Runs

Run on all files:
```bash
.venv/bin/pre-commit run --all-files
```

Run on staged files only:
```bash
.venv/bin/pre-commit run
```

Run a specific hook:
```bash
.venv/bin/pre-commit run ruff --all-files
.venv/bin/pre-commit run eslint --all-files
.venv/bin/pre-commit run check-json --all-files
```

### Auto-fix Issues

Python (Ruff):
```bash
.venv/bin/ruff check --fix .
.venv/bin/ruff format .
```

JavaScript (ESLint):
```bash
# Via pre-commit (includes auto-fix)
.venv/bin/pre-commit run eslint --all-files
```

## Bypassing Hooks (Not Recommended)

If you need to commit without running hooks (emergency only):
```bash
git commit --no-verify
```

## Configuration Files

- `.pre-commit-config.yaml` - Pre-commit hook configuration
- `ruff.toml` - Python linting rules
- `eslint.config.js` - JavaScript linting rules

## Race Picker Regression Checks

These focused checks use Python's standard-library `unittest` runner and Node's built-in test runner (Node 20.19+). No additional test dependencies are needed.

```bash
.venv/bin/python3 -m unittest discover -s tests -p 'test_race_suggestions.py' -v
node --experimental-default-type=module --test tests/race-suggestions.test.mjs
```

The Python checks use a temporary database, not the application's database. They cover current-finisher medians and the page/API routes. The JavaScript checks cover filter boundaries, personal history, classification, catchability ordering, distance ordering and escaped table output.

## Podium Ship Statistics Regression Checks

```bash
.venv/bin/python3 -m unittest discover -s tests -p 'test_stats.py' -v
node --experimental-default-type=module --test tests/stats.test.mjs
```

The Python checks use a temporary database and cover current top-three entries (one per commander/race), ship-only filtering, separate Multi-system / Multi-planet groups, and independent top-N limits including popularity ties. Equal race times are ordered by commander name, matching the race leaderboard and selecting at most three finishers. Blank or non-ship vehicle entries are excluded after podium selection, without promoting fourth place.

The stats API exposes `top_podium_ship_types` for ship races with neither the Multi-system nor Multi-planet badge, and `top_podium_ship_types_multi` for races with either or both badges. These badges use the `multi_system` and `multi_planet` metadata fields. Each set contains `{ship, count}` rows ordered by count descending, then ship name. The JavaScript check verifies that the two horizontal-bar charts appear beneath the ship/fighter popularity graphs, with Planetside Ship Races first, correct counts, escaped names, and empty states.

## Updating Hooks

To update to the latest hook versions:
```bash
.venv/bin/pre-commit autoupdate
```
