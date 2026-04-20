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

## Updating Hooks

To update to the latest hook versions:
```bash
.venv/bin/pre-commit autoupdate
```
