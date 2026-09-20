<img src="logo.svg" width="128" alt="Barnacle IMDS Proxy">

# Barnacle IMDS Proxy

Your local containers can't reach cloud providers' Instance Metadata Service. This Docker Desktop extension routes their IMDS requests to any IMDS request handler you run on your machine. It requires no code changes to your app and no static keys stored in your environment.

## What problem does this solve?

Cloud SDKs (AWS, GCP, Azure, etc.) check IMDS for credentials and other config when running in the cloud. This service typically runs at `169.254.169.254`. Local containers can't reach that address, so you need a workaround.

Barnacle handles the routing. You pair it with a credential server: use a purpose-built IMDS server like [imds-server](https://github.com/imdsutil/imds-server), run a provider-specific one like [gce_metadata_server](https://github.com/salrashid123/gce_metadata_server) for GCP, or copy a minimal script from [docs/recipes.md](docs/recipes.md).

The common options:

| Approach | App code changes? | Secrets in Dockerfile/Compose? | Per-container identity? | Multi-cloud? |
|---|---|---|---|---|
| Static env vars (`AWS_ACCESS_KEY_ID`, etc.) | None | Yes - env vars per container | Yes - but a static key per container | Messy - separate vars per provider |
| Credential files mounted (`~/.aws`) | None | No - a mount path, not key material | Yes - via `AWS_PROFILE` (or similar), but often breaks SSO and `credentials_process` unless the token cache and helper binaries are present in the container | AWS only without extra tooling |
| aws-vault | None | No | One identity per `exec` invocation - can't differ per service in one Compose file | AWS only |
| LocalStack[^1] | Yes - your code must target a different endpoint | No | No | AWS only |
| **Barnacle + credential server** | **None** | **No** | **Yes - via container labels** | **Yes - credential server routes by label**[^2] |

[^1]: LocalStack solves a different problem. It mocks AWS services locally so you can test without calling real APIs. It doesn't provide real credentials and requires your code to target a different endpoint. The others are credential solutions with different tradeoffs.

[^2]: Some providers need an extra host entry on the container. See [Providers that also need a host entry](#providers-that-also-need-a-host-entry).

## Requirements

- Docker Desktop. Barnacle runs as a Docker Desktop extension and does not work with plain Docker Engine or Podman.

## Install

Search for "Barnacle" in the Docker Desktop Extensions Marketplace.

## Quick start

1. Start a credential server: an HTTP server on your machine that answers IMDS requests with credentials. Copy a script from [docs/recipes.md](docs/recipes.md), or run a purpose-built one like [imds-server](https://github.com/imdsutil/imds-server).

   The recipe scripts listen on port 8080, so your server URL is `http://localhost:8080`.

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

### Providers that also need a host entry

Some SDKs reach the metadata service by DNS name instead of by IP. Intercepting the address is not enough for these. Map the name to the intercepted address as well:

```bash
docker run --add-host metadata.google.internal:169.254.169.254 ...   # GCP
docker run --add-host metadata.tencentyun.com:169.254.0.23 ...       # Tencent Cloud
```

In Compose, use `extra_hosts`. For GCP you can set `GCE_METADATA_HOST` on the container instead.

GCP Go SDKs use the IP and work without this. GCP Python SDKs, including `gcloud`, do not. Tencent SDKs never use the IP.

## How it works

Two services run inside the Docker Desktop VM:

- The **controller** watches Docker events and creates one Docker bridge network per /24 (IPv4) or /64 (IPv6) subnet, named after the subnet (e.g. `.imds-169.254.169.0`). When a labeled container starts, it briefly pauses it, connects it to those networks, then unpauses it. This is done before the container's process starts, so its first IMDS request usually arrives after the network is ready.
- The **proxy** binds to the configured IMDS addresses and forwards requests to your local IMDS server, adding `X-Container-Id`, `X-Container-Name`, and container label headers so your server knows which container made the request. Method, path, query string, body and all other headers pass through unchanged, so the IMDSv2 token exchange (`PUT /latest/api/token`) and provider headers such as `Metadata-Flavor: Google` reach your server intact.

For the full technical description, see [docs/architecture.md](docs/architecture.md).

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md).

## Related projects

These solve the same problem a different way. They identify the calling container from the request's source IP rather than proxying to a server you run, so they are alternatives to Barnacle rather than credential servers for it. All are AWS only.

- [go-metadataproxy](https://github.com/jippi/go-metadataproxy)
- [docker-ec2-metadata](https://github.com/compwright/docker-ec2-metadata)
- [metadataproxy](https://github.com/lyft/metadataproxy) - archived November 2025

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

## Accessibility

The extension UI targets [WCAG 2.1 Level AA](https://www.w3.org/TR/WCAG21/) conformance. To report an accessibility issue, [open a GitHub issue](https://github.com/imdsutil/barnacle-imds-proxy/issues).

## License

Apache 2.0 - see [LICENSE](LICENSE).
