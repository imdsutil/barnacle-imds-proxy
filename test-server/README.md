# Test Server

A simple HTTP server for local development and testing of the IMDS proxy extension.

## Running

In a separate terminal, start the server before launching your test containers:

```bash
# Default port 8080
make run-test-server

# Custom port
make run-test-server-port PORT=9000
```

Or directly from the `test-server/` directory:

```bash
go run main.go
go run main.go -port=9000
```

The server runs in the foreground and prints every incoming request to stdout. Keep this terminal visible while testing so you can see requests arrive in real time.

## Configuring the extension

1. Open Docker Desktop and go to the Barnacle extension's **Settings** tab.
2. Enter `http://localhost:8080` (or your custom port).
3. Click **Save Settings**.

The proxy automatically rewrites `localhost` to `host.docker.internal`, so you don't need to enter the internal hostname yourself.

## What it does

The server responds to all paths and logs every incoming request including headers. This lets you verify that `X-Container-Id`, `X-Container-Name`, and label headers are arriving from the proxy.

```bash
curl http://localhost:8080/test
```
