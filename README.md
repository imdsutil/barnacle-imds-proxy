<img src="logo.svg" width="128" alt="Barnacle IMDS Proxy">

# Barnacle IMDS Proxy

Your local containers can't reach cloud providers' Instance Metadata Service. This extension routes their IMDS requests to an IMDS request handler you run on your machine. It requires no code changes and no static keys stored in your environment.

## What problem does this solve?

Cloud SDKs (AWS, GCP, Azure, etc.) check the Instance Metadata Service for credentials and other config when running in the cloud. This service typically runs at `169.254.169.254`. Local containers can't reach that address, so you must use one of these workarounds:

| Approach | App code changes? | Secrets in Dockerfile/Compose? | Per-container identity? | Multi-cloud? |
|---|---|---|---|---|
| Static env vars (`AWS_ACCESS_KEY_ID`, etc.) | None | Yes - env vars per container | Yes - but a static key per container | Messy - separate vars per provider |
| Credential files mounted (`~/.aws`) | None | Yes - volume mount per container | Yes - via `AWS_PROFILE` (or similar), but static keys only (breaks SSO, `credentials_process`, etc.) | AWS only without extra tooling |
| aws-vault | None | No | No - manual exec wrapper, doesn't work well with Compose | AWS only |
| LocalStack[^1] | No (usually) | No | No | AWS only |
| **Barnacle + credential server** | **None** | **No** | **Yes - via container labels** | **Yes - credential server routes by label** |

[^1]: LocalStack solves a different problem. It mocks AWS services locally so you can test without calling real APIs. It doesn't provide real credentials and requires your code to target a different endpoint. The others are credential solutions with different tradeoffs.

Barnacle handles the routing. For the credential server, use a purpose-built IMDS server like [imds-server](https://github.com/imdsutil/imds-server). If you need something quick, copy a minimal script from [docs/recipes.md](docs/recipes.md).

## Install

Search for "Barnacle" in the Docker Desktop Extensions Marketplace.

## Quick start

1. Start a credential server. See [docs/recipes.md](docs/recipes.md) for copy-paste scripts for each cloud provider.

2. Open the extension and go to the **Settings** tab.

   - Enter your server URL. You can use `localhost`. The proxy rewrites it to `host.docker.internal` for you.
   - Add the IMDS addresses you want to intercept (e.g. `169.254.169.254` for AWS/GCP, `fd00:ec2::254` for AWS IPv6). Any IPv4 or IPv6 address works; see [Common addresses](#common-addresses) below.

3. Add the label `imds-proxy.enabled=true` to any container:

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

4. Done. The extension connects labeled containers to the configured IMDS addresses automatically. The Containers tab shows which containers are active and their network connectivity status.

## Common addresses

Any IPv4 or IPv6 address you add in Settings is intercepted. These are the well-known IMDS addresses for major providers:

| Provider       | Address               | Protocol |
|----------------|-----------------------|----------|
| AWS / GCP      | `169.254.169.254`     | IPv4     |
| AWS            | `fd00:ec2::254`       | IPv6     |
| OpenStack      | `fd00:a9fe:a9fe::254` | IPv6     |
| Alibaba Cloud  | `100.100.100.200`     | IPv4     |
| Tencent Cloud  | `169.254.0.23`        | IPv4     |

## How it works

Two services run inside the Docker Desktop VM:

- The **controller** watches Docker events and creates one Docker bridge network per /24 (IPv4) or /64 (IPv6) subnet, named after the subnet (e.g. `.imds-169.254.169.0`). When a labeled container starts, it briefly pauses it, connects it to those networks, then unpauses it. This ensures the network is ready before the container's process starts.
- The **proxy** binds to the configured IMDS addresses and forwards requests to your local IMDS server, adding `X-Container-Id`, `X-Container-Name`, and container label headers so your server knows which container made the request.

For the full technical description, see [docs/architecture.md](docs/architecture.md).

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md).

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

## Accessibility

The extension UI targets [WCAG 2.1 Level AA](https://www.w3.org/TR/WCAG21/) conformance. To report an accessibility issue, [open a GitHub issue](https://github.com/imdsutil/barnacle-imds-proxy/issues).

## License

Apache 2.0 - see [LICENSE](LICENSE).
