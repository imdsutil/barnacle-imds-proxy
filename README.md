<img src="logo.svg" width="128" alt="Barnacle IMDS Proxy">

# Barnacle IMDS Proxy

A Docker Desktop extension that forwards container IMDS requests to a server you control.

## Use cases

- Test IMDS-dependent code locally without deploying to the cloud
- Give local containers real cloud credentials with no code changes and no static keys (pair with a credential-serving IMDS server that reads container labels)
- Verify how your application handles different metadata responses per container

## Install

Search for "Barnacle" in the Docker Desktop Extensions Marketplace, or from a terminal:

```bash
docker extension install imdsutil/barnacle-imds-proxy
```

## Quick start

1. Open the extension in Docker Desktop and go to the **Settings** tab. Enter your IMDS server URL. You can use `localhost` — the proxy rewrites it to `host.docker.internal` for you.

2. Add the label `imds-proxy.enabled=true` to any container you want to proxy.

   In a Compose file:
   ```yaml
   services:
     my-app:
       image: my-app:latest
       labels:
         - "imds-proxy.enabled=true"
   ```

   Or with `docker run`:
   ```bash
   docker run --label imds-proxy.enabled=true my-app:latest
   ```

3. That's it. The extension connects labeled containers to the IMDS proxy automatically. The Containers tab shows which containers are active and their provider connectivity status.

## Supported addresses

| Provider   | Address               | Protocol |
|------------|-----------------------|----------|
| AWS / GCP  | `169.254.169.254`     | IPv4     |
| AWS        | `fd00:ec2::254`       | IPv6     |
| OpenStack  | `fd00:a9fe:a9fe::254` | IPv6     |

## How it works

Two services run inside the Docker Desktop VM:

- The **controller** watches Docker events. When a labeled container starts, it briefly pauses it, connects it to the IMDS networks, then unpauses it. This ensures the network is ready before the container's process starts.
- The **proxy** binds to the IMDS addresses and forwards requests to your server, adding `X-Container-Id`, `X-Container-Name`, and container label headers so your server knows which container made the request.

For a full technical description, see [docs/architecture.md](docs/architecture.md).

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md).

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

## Accessibility

The extension UI targets [WCAG 2.1 Level AA](https://www.w3.org/TR/WCAG21/) conformance. To report an accessibility issue, [open a GitHub issue](https://github.com/imdsutil/barnacle-imds-proxy/issues).

## License

Apache 2.0 — see [LICENSE](LICENSE).
