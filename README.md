# Barnacle IMDS Proxy

A Docker Desktop extension that intercepts container IMDS requests and forwards them to a server you control.

## What it does

When containers run locally, they often expect an Instance Metadata Service (IMDS) at the well-known cloud provider addresses (`169.254.169.254`, etc.). Barnacle sits at those addresses inside Docker Desktop's VM and proxies requests to your own IMDS server, adding headers that identify which container made the request. This lets you serve different metadata to different containers — useful for testing IAM role assumptions, instance identity, and other IMDS-dependent code without deploying to the cloud.

Supports the standard IMDS address ranges for AWS, GCP, and OpenStack (including IPv6).

## Install

Search for "Barnacle" in the Docker Desktop Extensions Marketplace, or install from the command line:

```bash
docker extension install imdsutil/barnacle-imds-proxy
```

## How to use it

1. Open the extension in Docker Desktop and set the URL of your IMDS server.
2. Add the label `imds-proxy.enabled=true` to any container you want to proxy. In Compose:

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

3. Labeled containers are automatically connected to the IMDS proxy networks. The extension UI shows which containers are currently being proxied.

## How it works

The extension runs two services inside the Docker Desktop VM:

- **Controller** — watches Docker events for containers with the enabled label, connects them to the IMDS networks, and tracks their state. Exposes a socket so the proxy can look up container info by IP.
- **Proxy** — binds to the IMDS addresses on dedicated Docker networks and forwards requests to your configured server, adding `X-Container-Id`, `X-Container-Name`, and container label headers.

When a labeled container starts, the controller pauses it briefly, attaches it to the IMDS networks, then unpauses it. This ensures the network routes are in place before the container's entrypoint runs.

## Supported IMDS addresses

| Provider       | Address              | Protocol |
|----------------|----------------------|----------|
| AWS / GCP      | `169.254.169.254`    | IPv4     |
| AWS (IPv6)     | `fd00:ec2::254`      | IPv6     |
| OpenStack      | `fd00:a9fe:a9fe::254`| IPv6     |

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).
