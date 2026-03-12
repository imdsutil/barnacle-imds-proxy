# Barnacle IMDS Proxy

A Docker Desktop Extension

Routes container requests for default IMDS endpoints to your configured server. Adds container info to request headers to allow for custom per-container IMDS responses.

# Development

## Git hooks

## Pre-commit

This repository uses [pre-commit](https://pre-commit.com/) hooks to run formatting, linting, and basic checks before commits.

### Install

```bash
uvx pre-commit install
```

### Run hooks manually

```bash
# Run on staged files (normal commit behavior)
uvx pre-commit run

# Run on all files (recommended before opening a PR)
uvx pre-commit run --all-files
```

### Update hook versions

```bash
uvx pre-commit autoupdate
```

### Notes

- Hooks run automatically on `git commit` after `uvx pre-commit install`.
- If a hook modifies files, review changes, re-stage, and commit again.
- To skip hooks for an emergency commit (use sparingly):
  ```bash
  git commit --no-verify
  ```
