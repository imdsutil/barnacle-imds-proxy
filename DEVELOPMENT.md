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

## Cross-platform testing

The extension runs inside Docker Desktop's Linux VM, so most code is platform-agnostic. The main variables are Docker Desktop's networking implementation on each platform.

### Test matrix

| Platform | Architecture | Notes |
|----------|-------------|-------|
| Linux | amd64 | Docker Desktop required, not bare Docker Engine |
| macOS | Apple Silicon (arm64) | |
| macOS | Intel (amd64) | |
| Windows | amd64 | |

### Test checklist

**Basic lifecycle**
- [ ] `make build-extension && make install-extension` succeeds
- [ ] Extension appears in Docker Desktop sidebar
- [ ] Uninstall is clean

**Networking**
- [ ] Both IMDS bridge networks are created (`.imds_aws_gcp`, `.imds_openstack`)
- [ ] IPv4 `169.254.169.254` is reachable from a labeled container
- [ ] IPv6 `fd00:ec2::254` is reachable from a labeled container
- [ ] IPv6 `fd00:a9fe:a9fe::254` is reachable from a labeled container

**Container attachment**
- [ ] Labeled container gets paused, attached to IMDS networks, and unpaused
- [ ] Container can reach the IMDS proxy after unpause
- [ ] Multiple labeled containers are all tracked

**End-to-end proxying**
- [ ] Run the test server on the host (`make run-test-server`)
- [ ] Configure the extension to point at `localhost:8080`
- [ ] `curl 169.254.169.254` from a labeled container returns the test server response
- [ ] `X-Container-Id` and `X-Container-Name` headers arrive at the test server

**UI**
- [ ] Extension loads without console errors
- [ ] Container list updates when labeled containers start/stop
- [ ] URL config persists across Docker Desktop restart

### Quick verification commands

Check that the IMDS networks were created:

```bash
docker network ls | grep imds
```

Start a labeled test container:

```bash
docker run -d --rm --name imds-test --label imds-proxy.enabled=true alpine sleep 3600
```

Verify it was attached to the IMDS networks:

```bash
docker inspect imds-test --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Test IPv4 IMDS reachability:

```bash
docker exec imds-test wget -qO- http://169.254.169.254/
```

Test IPv6 IMDS reachability:

```bash
docker exec imds-test wget -qO- "http://[fd00:ec2::254]/"
docker exec imds-test wget -qO- "http://[fd00:a9fe:a9fe::254]/"
```

Check that container identity headers reach the test server (run this while `make run-test-server` is running and the extension is pointed at `localhost:8080`):

```bash
docker exec imds-test wget -qO- http://169.254.169.254/ 2>&1
# Check the test server terminal output for X-Container-Id and X-Container-Name headers
```

Check extension logs:

```bash
docker logs imds-proxy-controller
docker logs imds-proxy
```

Clean up:

```bash
docker rm -f imds-test
```

### Platform-specific risks

- **Windows**: IPv6 in Docker Desktop has been flaky historically. The link-local subnet (`169.254.169.0/24`) could conflict with Windows' own link-local handling.
- **Linux**: `host.docker.internal` works on Docker Desktop for Linux but not on bare Docker Engine. The extension requires Docker Desktop.

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
