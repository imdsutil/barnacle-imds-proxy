# Development

## Prerequisites

- Docker Desktop (with extensions enabled)
- Go 1.24+
- Node.js 24+ and pnpm
- Make
- [bats-core](https://github.com/bats-core/bats-core) (for e2e tests)

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

There's also `make bench` for benchmarks and `make regression` for lint + tests + integration tests in one shot.

### End-to-end tests

The e2e tests use [bats](https://github.com/bats-core/bats-core) and run against a live extension install. Install bats with `npm install -g bats`, `brew install bats-core`, or `apt install bats`.

The test script starts its own test server and cleans up after itself. The extension must be installed and its URL set to `localhost:8080` before running:

```bash
make test-e2e
```

These tests start a labeled container, verify it gets attached to the IMDS networks, check that IMDS addresses are reachable, and confirm the proxy forwards container identity headers.

## Linting

```bash
make lint          # go vet on backend and proxy
make lint-fix      # pre-commit on all files
```

## Test server

The repo includes a test IMDS server for local development. Run it in a separate terminal before starting your test containers:

```bash
make run-test-server

# Custom port
make run-test-server-port PORT=9000
```

The server runs in the foreground and logs all incoming requests, including headers. Point the extension at `http://localhost:8080` (or your custom port) - the proxy rewrites `localhost` to `host.docker.internal` automatically.

## UI development

The UI is a React app using the Docker MUI theme. From the `ui/` directory:

```bash
pnpm install
pnpm dev          # Vite dev server with hot reload
pnpm test         # Vitest
pnpm run build    # Production build
```

Note that `pnpm dev` runs a standalone Vite server, which is useful for working on the UI, but the Docker Desktop extension API calls won't work outside of Docker Desktop. You'll see an error on init. The build output is what actually gets packaged into the extension image.

To point the installed extension at that dev server instead of its bundled build:

```bash
docker extension dev ui-source barnacle-imds-proxy http://localhost:3000
docker extension dev debug barnacle-imds-proxy      # DevTools on each tab click
docker extension dev reset barnacle-imds-proxy      # undo both
```

Until you reset, the extension tab depends on the dev server staying up. Note that `vite.config.ts` sets `strictPort`, so `pnpm dev` fails outright if something else already holds port 3000 rather than picking another one.

## Debugging the extension inside Docker Desktop

On a Wayland desktop, Docker Desktop's window is a native Wayland client, so no X tool can see or drive it. `scripts/gui-debug.sh` works around that by running Docker Desktop inside a nested X server, leaving your own session alone.

```bash
sudo apt install xserver-xephyr xdotool imagemagick

./scripts/gui-debug.sh start           # nested display, Docker Desktop moved into it
./scripts/gui-debug.sh shot out.png    # screenshot the extension window
./scripts/gui-debug.sh click 163 192   # coordinates relative to that window
./scripts/gui-debug.sh stop            # put everything back
```

`shot` and `click` default to the extension webview, which is its own X window, so coordinates read off a screenshot can be passed straight to `click`. Use `--target dashboard` for Docker Desktop's own chrome and `--full` to capture the whole display.

Xephyr is software-rendered, so Docker Desktop is slow inside it. Run `stop` when you are finished. It tears down the whole dev setup: removes the systemd drop-in, restarts Docker Desktop on the normal display, stops Xephyr, resets the extension's `ui-source` and debug mode, and stops this checkout's Vite dev server. It only ever stops a Vite running out of this repo, so another project's dev server on the same port is left alone.

Tests for the script are hermetic and need no display:

```bash
bats scripts/test-gui-debug.sh
```

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
- [ ] Both IMDS bridge networks are created (`.imds-0`, `.imds-1`)
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
