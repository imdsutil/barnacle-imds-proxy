# Barnacle IMDS Proxy - Manual Test Plan

Run on each platform: **macOS**, **Windows**, **Linux**.

---

## Prerequisites

- Docker Desktop installed and running
- Barnacle IMDS Proxy extension installed
- A test IMDS server running and reachable. Start one with:

  ```bash
  docker run --rm -p 8080:8080 -e HTTP_PORT=8080 mendhak/http-https-echo:latest
  ```

  This echoes every request back as JSON including all headers, so you can verify `X-Container-Id`, `X-Container-Name`, and label headers arrive correctly.

- Two labeled containers, for the Containers tab checks:

  ```shell
  docker run -d --rm --name test-imds-1 --label imds-proxy.enabled=true alpine sleep 3600
  docker run -d --rm --name test-imds-2 --label imds-proxy.enabled=true alpine sleep 3600
  ```

- The external settings-update command, for the Settings tab checks:

  zsh/bash:
  ```shell
  docker exec imds-proxy-controller \
    curl -sf --unix-socket /run/guest-services/backend.sock \
    -X POST -H 'Content-Type: application/json' \
    -d '{"url":"http://localhost:9999"}' \
    http://localhost/settings
  ```

  PowerShell:
  ```powershell
  docker exec imds-proxy-controller curl -sf --unix-socket /run/guest-services/backend.sock -X POST -H "Content-Type: application/json" -d '{\"url\":\"http://localhost:9999\"}' http://localhost/settings
  ```

Cleanup when done:

```shell
docker rm -f test-imds-1 test-imds-2
```

---

## Docker Desktop shell

| # | Action | Expected |
|---|--------|----------|
| 1 | Open Docker Desktop, find the extension tab, open it | Extension tab appears and opens |
| 2 | Settings > Appearance, switch to light mode then dark mode, checking text, backgrounds and alerts in each | Everything is legible in both |
| 3 | Tab through the UI in both light and dark mode | Focus rings are clearly visible against the background in both |

---

## Containers tab

Needs the two labeled containers from Prerequisites and at least one
configured IP in Settings.

| # | Action | Expected |
|---|--------|----------|
| 4 | With no labeled containers running, check the count at the bottom right, then start the labeled containers and check again | Reads "Showing 0 items", then updates as containers appear |
| 5 | Hover a container row | Name copy and ID copy icons appear |
| 6 | Hover the label hint code element, then click it | Background darkens on hover; snackbar "Copied label to clipboard" |
| 7 | Click the ID copy icon | Snackbar "Copied container ID to clipboard" |
| 8 | Click a row to expand, click again to collapse, then click the expand arrow directly | Row toggles each time, without triggering name or ID copy |
| 9 | Copy a container name or ID, then paste it somewhere outside Docker Desktop | The pasted value matches |

---

## Settings tab

| # | Action | Expected |
|---|--------|----------|
| 10 | Enter a URL, click Save, reopen the tab | Setting saved and reloaded correctly |
| 11 | Save a URL, switch to the Containers tab, switch back | The saved URL is still shown |
| 12 | With the Settings tab open, run the external settings-update command from Prerequisites | URL field updates within about 5 seconds, with no skeleton flicker |
| 13 | Edit the URL field without saving, then run the external settings-update command | The unsaved edit is not overwritten. Covered by `settings.browser.test.tsx` |
| 14 | Stop the controller with `docker stop imds-proxy-controller`, then edit the URL field | Field keeps what you typed. Saving shows an error toast and still does not change the text. Covered by `proxyState.browser.test.tsx` |

Restart the controller when done:

```shell
docker start imds-proxy-controller
```

---

## Header

| # | Action | Expected |
|---|--------|----------|
| 15 | Click "View documentation" | The GitHub repo opens in the system browser, not inside Docker Desktop |

---

## Cleanup

```shell
docker rm -f test-imds-1 test-imds-2
```
