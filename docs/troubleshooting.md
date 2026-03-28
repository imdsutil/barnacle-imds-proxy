# Troubleshooting

## Extension backend not responding

The extension UI shows a warning banner if it can't reach the controller. This usually means the `imds-proxy-controller` container stopped or crashed.

Try these steps in order:

1. **Navigate away and back.** Click on another Docker Desktop section (Containers, Images, etc.) and then return to the extension. Docker Desktop sometimes loses the connection to an extension's backend after the VM is idle.

2. **Disable and re-enable the extension.** Open Docker Desktop settings, go to Extensions, find Barnacle IMDS Proxy, disable it, and re-enable it. This restarts the extension's containers.

3. **Restart Docker Desktop.**

4. **Reboot.** If nothing else works, a reboot clears any VM networking issues.

To check whether the containers are actually running:

```bash
docker ps --filter name=imds-proxy
```

You should see `imds-proxy-controller` and `imds-proxy` both in `Up` status.

> **Note:** Extension containers are hidden by default. If the command returns nothing, enable **Show Docker Extensions system containers** in Docker Desktop: Settings > Extensions. Without that, `docker ps` and `docker ps -a` won't show them.

To check logs for errors:

```bash
docker logs imds-proxy-controller
docker logs imds-proxy
```

---

## IMDS requests not reaching my server

**Check the URL is saved.** Open the Settings tab and confirm the URL field shows what you expect. If it's empty, the proxy has nowhere to forward requests.

**Check the proxy is running.** The Containers tab shows a warning if the proxy container has stopped or crashed.

**Check the container has the label.** Only containers with `imds-proxy.enabled=true` are attached to the IMDS networks. Containers without the label get connection refused.

```bash
docker inspect <container-name> --format '{{index .Config.Labels "imds-proxy.enabled"}}'
```

Should output `true`.

**Check network attachment.** The container should be connected to both IMDS networks. The provider pills in the UI show this at a glance. To check directly:

```bash
docker inspect <container-name> --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Look for names ending in `.imds-0` and `.imds-1`.

**Check the IMDS address is reachable from the container.**

```bash
docker exec <container-name> wget -qO- --timeout=5 http://169.254.169.254/
```

If that times out but the container is attached to the IMDS network, the proxy may not be running.

---

## Provider pills are yellow or red

Yellow means one IMDS network is connected but not the other. Red means neither is connected.

This usually happens right after a container starts (the controller hasn't finished attaching it yet) or if a network was manually disconnected.

If the pills stay red after a minute, check whether the IMDS networks exist:

```bash
docker network ls | grep imds
```

You should see two networks with names ending in `.imds-0` and `.imds-1`. If they're missing, reinstalling the extension will recreate them.

---

## My server receives requests but the wrong URL

If you set the URL to `http://localhost:8080`, the proxy rewrites it to `http://host.docker.internal:8080` before forwarding. This is expected. Inside the Docker Desktop VM, `localhost` refers to the VM, not your host machine. The rewrite makes it reach your host.

If your server is bound to `127.0.0.1` only (not `0.0.0.0`), it won't accept connections from `host.docker.internal`. Make sure your server listens on `0.0.0.0`.

---

## Container is not in the Containers tab

The Containers tab only shows containers that have the `imds-proxy.enabled=true` label and are currently running. Stopped containers are not listed.

If a container is running and labeled but not showing up, check whether the backend is reachable (the warning banner would appear if not). You can also check controller logs to see if the attach event was processed:

```bash
docker logs imds-proxy-controller | grep <container-name>
```

---

## Still stuck?

[Open a GitHub issue](https://github.com/imdsutil/barnacle-imds-proxy/issues) with the output of `docker logs imds-proxy-controller` and `docker logs imds-proxy`.
