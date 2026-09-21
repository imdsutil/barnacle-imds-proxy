# Barnacle IMDS Proxy - Manual Test Runbook

Work through this top to bottom in one pass. Every command you need is printed
at the step that needs it, so you never have to scroll back.

Run the whole runbook on each platform: **macOS**, **Windows**, **Linux**.

Most of the UI is covered by the browser suite (`make test-ui-browser`). The
steps here are the ones a headless browser cannot check: real Docker Desktop
theming, real clipboard, real system browser, and real container traffic.

---

## Before you start

You need Docker Desktop running and the Barnacle IMDS Proxy extension
installed. To build and install the current working tree:

```shell
make update-extension
```

Start the echo server that stands in for an IMDS server. It echoes every
request back as JSON including all headers, so you can confirm
`X-Container-Id`, `X-Container-Name` and label headers arrive:

```shell
docker run --rm -p 8080:8080 -e HTTP_PORT=8080 mendhak/http-https-echo:latest
```

Leave that running in its own terminal for the whole run.

Do **not** start the labeled test containers yet. Step 11 needs them absent to
begin with, and they only attach to the proxy network once step 6 has
configured an address.

---

## Docker Desktop shell

### 1. The extension loads

Open Docker Desktop and find the Barnacle IMDS Proxy tab.

**Expect:** the tab appears and opens without error.

### 2. Both colour schemes are legible

Go to Settings > Appearance and switch to light mode, then dark mode. In each,
look at text, backgrounds and alerts on both tabs.

**Expect:** everything is legible in both.

### 3. Focus is visible in both schemes

Tab through the UI in light mode, then again in dark mode.

**Expect:** focus rings are clearly visible against the background in both.

---

## Settings tab

Do this section before the Containers tab, because the container checks need a
configured address.

### 4. A setting saves and survives a reload

Open the Settings tab, enter `http://localhost:8080`, click Save, then close
and reopen the extension.

**Expect:** the URL is still there.

### 5. A setting survives a tab switch

Switch to the Containers tab and back to Settings.

**Expect:** the saved URL is still shown.

### 6. Add the IMDS address

Still on Settings, add `169.254.169.254` and click Save.

**Expect:** it appears as a chip and saves. Leave it configured, the Containers
tab checks need it.

### 7. An external update lands without flicker

Leave the Settings tab open and run:

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

**Expect:** the URL field updates to `http://localhost:9999` within about 5
seconds, with no skeleton flicker.

### 8. An external update does not overwrite your edit

Type a different URL into the field and leave it unsaved. Then run the same
command again:

```shell
docker exec imds-proxy-controller \
  curl -sf --unix-socket /run/guest-services/backend.sock \
  -X POST -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:7777"}' \
  http://localhost/settings
```

PowerShell:

```powershell
docker exec imds-proxy-controller curl -sf --unix-socket /run/guest-services/backend.sock -X POST -H "Content-Type: application/json" -d '{\"url\":\"http://localhost:7777\"}' http://localhost/settings
```

**Expect:** your unsaved edit stays exactly as you typed it.

_Also covered by `settings.browser.test.tsx`._

### 9. An edit you cannot save is never discarded

Stop the controller:

```shell
docker stop imds-proxy-controller
```

Edit the URL field, wait at least 10 seconds, then click Save.

**Expect:** the text stays exactly as you typed it the whole time, and Save
shows an error toast. Nothing reverts.

Restart the controller before continuing:

```shell
docker start imds-proxy-controller
```

Then set the URL back to the echo server and save:

`http://localhost:8080`

_Also covered by `proxyState.browser.test.tsx`._

### 10. Reordering the IP list does not freeze the tab

Remove a configured IP with its chip delete button, then add the same IP back.

**Expect:** the Save button stays disabled, because the set has not changed,
and the tab keeps updating rather than freezing on stale data.

_Also covered by `settings.browser.test.tsx`._

---

## Containers tab

### 11. The count tracks containers appearing

Open the Containers tab with no labeled containers running and read the count
at the bottom right. Then start two:

```shell
docker run -d --rm --name test-imds-1 --label imds-proxy.enabled=true alpine sleep 3600
docker run -d --rm --name test-imds-2 --label imds-proxy.enabled=true alpine sleep 3600
```

**Expect:** it reads "Showing 0 items" first, then updates as the containers
appear.

### 12. Copy icons appear on hover

Hover a container row.

**Expect:** the name copy and ID copy icons appear.

### 13. The label hint copies

Hover the label hint code element, then click it.

**Expect:** the background darkens on hover, then a snackbar reads "Copied
label to clipboard".

### 14. The container ID copies

Click the ID copy icon on a row.

**Expect:** a snackbar reads "Copied container ID to clipboard".

### 15. Rows expand without triggering a copy

Click a row to expand it, click again to collapse it, then click the expand
arrow directly.

**Expect:** the row toggles each time, and no name or ID copy fires.

### 16. Copied values are really on the clipboard

Copy a container name, then paste it outside Docker Desktop. Do the same with
a container ID.

**Expect:** each pasted value matches what you copied.

### 17. Traffic reaches the IMDS server with identity headers

Request the metadata address from inside one of the labeled containers:

```shell
docker exec test-imds-1 wget -qO- http://169.254.169.254/latest/meta-data/
```

**Expect:** the command prints the echoed JSON directly, and its `headers`
object contains the identity the proxy added:

```json
"x-container-id": "2343c198a984...",
"x-container-name": "/test-imds-1",
"x-container-labels": "{\"imds-proxy.enabled\":\"true\"}"
```

The name carries a leading slash, which is how Docker reports it. The
Containers tab strips it for display.

---

## Header

### 18. Documentation opens outside Docker Desktop

Click "View documentation".

**Expect:** the GitHub repo opens in your system browser, not inside a Docker
Desktop window.

---

## When you are done

```shell
docker rm -f test-imds-1 test-imds-2
docker start imds-proxy-controller
```

Stop the echo server with Ctrl-C in its terminal.

Check the controller is running, since several steps stop it:

```shell
docker ps --filter name=imds-proxy-controller
```
