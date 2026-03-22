# Development

## Prerequisites

- Docker Desktop (with extensions enabled)
- Go 1.24+
- Node.js 24+ and pnpm
- Make

## Build and install locally

```bash
make build-extension
make install-extension
```

This builds both the extension image and the proxy image, then installs the extension into Docker Desktop. If you already have it installed and want to pick up changes:

```bash
make update-extension
```

## Running tests

```bash
# Everything
make test

# Individual components
make test-backend
make test-proxy
make test-ui

# With race detector
make test-race

# Integration tests
make test-integration

# Coverage (fails if below 80%)
make test-coverage
```

There's also `make bench` for benchmarks and `make regression` for the full suite including race detection and integration tests.

## Linting

```bash
make lint          # go vet on backend and proxy
make lint-fix      # pre-commit on all files
```

## Test server

The repo includes a test IMDS server for local development:

```bash
make run-test-server
```

This starts a server on port 8080. Point the extension at `http://localhost:8080` (the proxy rewrites `localhost` to `host.docker.internal` automatically). You can also pick a different port:

```bash
make run-test-server-port PORT=9000
```

## UI development

The UI is a React app using the Docker MUI theme. From the `ui/` directory:

```bash
pnpm install
pnpm dev          # Vite dev server with hot reload
pnpm test         # Vitest
pnpm run build    # Production build
```

Note that `pnpm dev` runs a standalone Vite server, which is useful for working on the UI, but the Docker Desktop extension API calls won't work outside of Docker Desktop. You'll see an error on init. The build output is what actually gets packaged into the extension image.

## Git hooks

### Pre-commit

This repository uses [pre-commit](https://pre-commit.com/) hooks for formatting, linting, and basic checks.

```bash
make setup         # Installs pre-commit and activates hooks
```

The setup target will find and use whichever of `uv`, `pyenv`, `pip`, or `brew` you have available. After that, hooks run automatically on every commit.

If a hook modifies files, review the changes, re-stage, and commit again.

To update hook versions:

```bash
uvx pre-commit autoupdate
```
