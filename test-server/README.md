# Test Server

A simple HTTP server for testing the IMDS proxy extension during development.

## Running the Server

### Using Make (Recommended)

```bash
# Run on default port 8080
make run-test-server

# Run on custom port
make run-test-server-port PORT=9000
```

### Running Directly

```bash
cd test-server

# Default port 8080
go run main.go

# Custom port
go run main.go -port=9000
```

## Configuring the Extension

Once the test server is running, configure your extension to point to it:

1. Open Docker Desktop
2. Go to your extension
3. Select "URL (not localhost)" option
4. Enter: `http://host.docker.internal:8080` (or your custom port)
5. Click "Save Settings"

> **Note:** Use `host.docker.internal` instead of `localhost` because the extension runs inside a Docker container and needs to reach the host machine.

## Testing

The server responds to all paths with JSON:

```bash
# Test from your terminal
curl http://localhost:8080/test

# Example response
{
  "message": "Hello from test server!",
  "timestamp": "2026-02-03T10:30:45.123Z",
  "path": "/test",
  "method": "GET"
}
```

## Features

- Returns JSON response for all requests
- Logs all incoming requests
- Configurable port
- Simple and lightweight
