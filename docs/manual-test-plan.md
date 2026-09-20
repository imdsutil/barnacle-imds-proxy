# Barnacle IMDS Proxy - Manual Test Plan

Run on each platform: **macOS**, **Windows**, **Linux**.

---

## What to test by hand

Everything else is covered by `make test` (the browser suite in
`ui/src/__tests__/browser/`) or `scripts/test-e2e.sh`. This is the complete
list of what still needs a person, and why.

### Docker Desktop shell

| Action | Expected | Why it's manual |
|--------|----------|------------------|
| Open Docker Desktop, find the extension tab, open it | Extension tab appears and opens | The browser suite runs outside Docker Desktop; it can't prove the tab shows up there |
| Switch Docker Desktop → Settings → Appearance to light mode, then dark mode. Check text, backgrounds, and alerts in each | Everything is legible in both modes | The suite seeds stub theme objects (`window.__ddMuiV6Themes` set to empty objects), not Docker Desktop's real palette |
| Tab through the UI in both light and dark mode | Focus rings are clearly visible against the background in both | Same stub-theme limitation as above |

### Containers tab

Requires two labeled containers running (see Prerequisites) and at least one
configured IP in Settings.

| Action | Expected | Why it's manual |
|--------|----------|------------------|
| With no labeled containers running, check the bottom-right count; then start labeled containers and check again | Count reads "Showing 0 items", then updates as containers appear | Item counts aren't asserted by the suite |
| Hover a container row | Name copy and ID copy icons appear | Hover-only visual, not observable headless |
| Click the label hint code element with the mouse; hover over it | Snackbar "Copied label to clipboard", clipboard has `imds-proxy.enabled=true`; background darkens on hover | Only the keyboard path (Enter/Space) on this element is covered; hover isn't observable headless |
| Click the ID copy icon with the mouse | Snackbar "Copied container ID to clipboard", clipboard has the full ID | Only the name-copy icon is covered by a real click test; ID copy isn't |
| Click a row to expand it, click again to collapse, then click the expand arrow directly | Row toggles each time, without triggering name/ID copy | Only keyboard-driven expand/collapse is covered; real mouse clicks aren't |
| Copy a container name or ID and paste it somewhere | The real system clipboard has the value | `navigator.clipboard.writeText` always rejects in headless Chromium under Playwright (NotAllowedError), so the suite stubs `writeText` and never performs a real write |

### Settings tab

| Action | Expected | Why it's manual |
|--------|----------|------------------|
| Enter a URL, click Save, confirm it against the real Docker Desktop backend | Setting saves and reloads correctly | Proves the real `@docker/extension-api-client` transport still matches the fake one the suite uses; the suite itself can't reach a real backend |
| Save a URL, switch to the Containers tab, switch back to Settings | The previously saved URL is still shown | No browser test switches tabs and back to check this |
| While on the Settings tab, run the external settings-update command from the Prerequisites | URL field updates to the new value within ~5 seconds, no skeleton flicker | Not exercised by the suite |
| Edit the URL field without saving, then run the external settings-update command | The unsaved edit is NOT overwritten | Disabled: `test.skip("a settings poll does not overwrite text being typed", ...)` in `settings.browser.test.tsx`, pending issue #77 |
| Stop the controller (`docker stop imds-proxy-controller`) to reach the backend-unreachable state, then edit the URL field | Field reverts to the previously saved value after a few seconds (current behavior; itself under discussion) | Disabled: `test.skip` in `proxyState.browser.test.tsx`, pending issue #77 |

### Header

| Action | Expected | Why it's manual |
|--------|----------|------------------|
| Click "View documentation" | GitHub repo opens in the system browser, not inside Docker Desktop | The suite can assert `host.openExternal` is called with the right URL, but not that Docker Desktop actually hands off to the system browser |

**One coverage hole with no manual substitute.** The automated WCAG A and AA
audits are disabled because of two known violations, #70 (`aria-expanded` on a
`<tr>`) and #71 (the add IP address button has no accessible name). While they
are disabled, a newly introduced accessibility violation would not be caught.
There is no useful manual step here: re-running axe by hand before each release
only rediscovers the two violations already filed. Fixing #70 and #71 removes
the `.skip`s and the audits resume covering this automatically.

Proxy traffic (originally section 13) needs no GUI and isn't part of this
checklist; it's covered by `scripts/test-e2e.sh`.

`scripts/gui-debug.sh` drives the real extension in a nested display if you
want to do any of the above without a physical Docker Desktop window.

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

# Reference: what the automated suite covers

The sections below are **not a checklist**. They record which test file
covers which check, section by section, for auditing coverage or when
changing that code. Anything that still needs a human is in "What to test by
hand" above, not here.

## 1. Initial load

Automated in `ui/src/__tests__/browser/containers.browser.test.tsx` and
`a11y.browser.test.tsx`.

Checks 1.7 and 9.10 originally said "Tab to the tab bar" / "Tab to Settings
tab, press Enter". MUI Tabs use the ARIA roving tabindex pattern: Tab lands on
the currently selected tab, Arrow keys move between tabs, and Tab again leaves
the tablist. You cannot Tab directly to an unselected tab. The rows below are
reworded to match the real pattern and are covered by
`a11y.browser.test.tsx`'s keyboard tests.

| # | Action | Expected |
|---|--------|----------|
| 1.7 | Tab into the tab bar, then press Right Arrow to reach the Settings tab | "Containers" and "Settings" tabs are both reachable this way |

---

## 2. Containers tab - empty state

Automated in `ui/src/__tests__/browser/containers.browser.test.tsx` and
`a11y.browser.test.tsx`, except:

zsh/bash:
```shell
docker rm -f $(docker ps -q --filter label=imds-proxy.enabled=true) 2>/dev/null || true
```

PowerShell:
```powershell
$ids = docker ps -q --filter label=imds-proxy.enabled=true; if ($ids) { docker rm -f $ids }
```

| # | Action | Expected |
|---|--------|----------|
| 2.2 | Ensure no labeled containers are running | Item count at bottom-right reads "Showing 0 items" |

---

## 3. Label copy affordance

Automated in `ui/src/__tests__/browser/containers.browser.test.tsx` covers
that the label hint text is visible. The copy interaction on the label code
element itself (as opposed to the per-row name/id copy icons) is not
exercised anywhere in the suite, and hover styling is not something the
headless suite can observe.

| # | Action | Expected |
|---|--------|----------|
| 3.2 | Click the code element | Snackbar shows "Copied label to clipboard"; clipboard contains `imds-proxy.enabled=true` |
| 3.3 | Tab to the code element, press Enter | Same clipboard and snackbar result as 3.2 |
| 3.4 | Tab to the code element, press Space | Same result |
| 3.5 | Hover over the code element | Background darkens slightly |

---

## 4. Containers tab - with labeled containers

Automated in `ui/src/__tests__/browser/containers.browser.test.tsx`,
`a11y.browser.test.tsx`, and the clipboard tests in
`appearance.browser.test.tsx` (name copy only). Remaining gaps: hover-reveal
of the icons, the ID copy icon specifically, mouse-click (as opposed to
keyboard) row expand/collapse, and the item count.

```shell
docker run -d --rm --name test-imds-1 --label imds-proxy.enabled=true alpine sleep 3600
docker run -d --rm --name test-imds-2 --label imds-proxy.enabled=true alpine sleep 3600
```

| # | Action | Expected |
|---|--------|----------|
| 4.2 | Containers appear in the table | Item count at bottom-right updates |
| 4.3 | Hover a row | Name copy icon and ID copy icon appear |
| 4.5 | Click ID copy icon | Snackbar "Copied container ID to clipboard"; clipboard contains the full ID |
| 4.6 | Click a row | Row expands to show a "Labels" section with key/value pairs in monospace |
| 4.7 | Click the row again | Row collapses |
| 4.8 | Click the expand/collapse arrow button directly | Row toggles without triggering name/ID copy |

### Keyboard accessibility

Automated in `ui/src/__tests__/browser/a11y.browser.test.tsx` (checks
4.9-4.17). The WCAG A/AA audits in that file (currently `test.skip` pending
issues #70 and #71) include a color-contrast check that runs against MUI's
default palette, since the harness seeds `window.__ddMuiV6Themes` with empty
theme objects rather than Docker Desktop's real ones; once unskipped, a
passing audit says nothing about the colors a user actually sees.

---

## 5. Network connectivity chips

Requires the containers from section 4 and at least one IP configured in Settings (e.g. `169.254.169.254`).

The browser suite's fixtures only ever set `connected: true`, so the
disconnected chip colour, the tooltip text, and the live transition after
stopping/starting the proxy are not covered.

| # | Action | Expected |
|---|--------|----------|
| 5.1 | Observe the "Networks" column for a running labeled container | One chip per configured IP address |
| 5.2 | | Connected addresses show a green outlined chip |
| 5.3 | | Disconnected addresses show a grey outlined chip |
| 5.4 | Hover a chip | Tooltip reads "Connected" or "Not connected" |
| 5.5 | Stop the proxy container (`docker stop imds-proxy`) | Chips may turn grey (container still tracked but proxy not routing) |
| 5.6 | Start the proxy again | Chips return to green after the next poll |

To confirm network attachment via CLI:

```shell
docker inspect test-imds-1 --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Expected output contains one network per configured IP subnet: `.imds-169.254.169.0` for `169.254.169.254`, `.imds-fd00-ec2--` for `fd00:ec2::254`, etc.

---

## 6. Sorting

Requires at least 2 labeled containers (see section 4).

Fully automated. `ui/src/__tests__/browser/containers.browser.test.tsx`
covers 6.1 to 6.4 by clicking both column headers and asserting ascending and
descending order, and `ui/src/__tests__/browser/a11y.browser.test.tsx` covers
6.5 to 6.7 by reaching each header with real Tab traversal and activating it
with Enter.

The table below is kept for reference. Run it by hand only when changing the
sort implementation or the table's markup.

| # | Action | Expected |
|---|--------|----------|
| 6.1 | Click "Name" column header | Rows sort ascending by name; sort arrow visible |
| 6.2 | Click "Name" again | Rows sort descending |
| 6.3 | Click "Container ID" header | Rows sort ascending by ID |
| 6.4 | Click "Container ID" again | Rows sort descending |
| 6.5 | Tab to "Name" column header | Header receives visible focus |
| 6.6 | Press Enter on focused "Name" header | Rows sort; sort arrow updates |
| 6.7 | Tab to "Container ID" header, press Enter | Sorts by ID |

---

## 7. Proxy container state alerts

`ui/src/__tests__/browser/proxyState.browser.test.tsx` confirms that each of
the four abnormal statuses produces a visible `role="alert"`, but not the
alert's wording, its action button, or what happens when that button is
clicked.

Two other tests in this file are `test.skip` and don't correspond to a
numbered check below: a malformed `/containers` response should drive the
app into the same backend-unreachable state as a real failed request but
doesn't (issue #75), and a single malformed container element blanks the
whole panel instead of being skipped over (issue #74). Both are type-guard
robustness bugs with no way to reproduce them through the GUI, so they stay
tracked on their issues rather than appearing as manual steps here.

### 7a. Stopped

```shell
docker stop imds-proxy
```

| # | Action | Expected |
|---|--------|----------|
| 7.1 | Extension updates | Warning alert: "The IMDS proxy container has stopped - IMDS requests are not being proxied." with a "Start" button |
| 7.2 | Click "Start" | Alert disappears; proxy container returns to running |
| 7.3 | Tab to the "Start" button in the alert | Button receives visible focus |
| 7.4 | Press Enter on focused "Start" button | Same result as click |

### 7b. Paused

```shell
docker pause imds-proxy
```

| # | Action | Expected |
|---|--------|----------|
| 7.5 | Extension updates | Warning alert: "The IMDS proxy container is paused..." with "Unpause" button |
| 7.6 | Tab to "Unpause", press Enter | Alert disappears |

### 7c. Crashed

```shell
docker kill --signal=SIGKILL imds-proxy
```

| # | Action | Expected |
|---|--------|----------|
| 7.7 | Extension updates | Error alert: "The IMDS proxy container has crashed..." with "Start" button |
| 7.8 | Tab to "Start", press Enter | Alert clears |

### 7d. Missing

```shell
docker rm -f imds-proxy
```

| # | Action | Expected |
|---|--------|----------|
| 7.9 | Extension updates | Error alert: "The IMDS proxy container is not running..." with "Start" button |
| 7.10 | Tab to "Start", press Enter | Container is recreated via compose and alert clears |

---

## 8. Backend unreachable

Stop the controller to simulate a dead backend:

```shell
docker stop imds-proxy-controller
```

Almost fully automated. `ui/src/__tests__/browser/appearance.browser.test.tsx`
covers 8.1, the Containers tab unreachable banner. `proxyState.browser.test.tsx`
covers 8.2 and 8.6, 8.8 and 8.10: the Settings tab warning, the dialog's
recovery steps, the troubleshooting link, and clean recovery when the backend
returns. `a11y.browser.test.tsx` covers 8.4, 8.7 and 8.9: reaching "Get help"
by Tab, tabbing through the dialog, and dismissing it by Escape and by the
close button with focus returning to the trigger. 8.5 is exercised by every
test that opens the dialog rather than having one of its own.

**8.3 is NOT covered and is a known bug.** The test for it is skipped against
issue #77: the settings poll only reloads when the form has no unsaved edits,
so an edit made during an outage never reverts. Check 8.3 by hand until that
is fixed. Note the expected behaviour itself is under discussion on #77, since
silently reverting a user's typing is arguably the wrong remedy.

| # | Action | Expected |
|---|--------|----------|
| 8.2 | Settings tab | Warning alert: "Extension backend not responding. Your last saved settings are shown below, but changes cannot be saved." with "Get help" button |
| 8.3 | Settings tab: edit the URL field | Field reverts to the previously saved value after a few seconds |
| 8.4 | Tab to "Get help" button | Button receives visible focus; button is vertically centered in the alert |
| 8.5 | Press Enter on "Get help" | Help dialog opens |
| 8.6 | Dialog recovery steps are listed in order of severity: | |
| | a) Navigate away in Docker Desktop and return to the extension | |
| | b) Disable then re-enable the extension in the Extensions Marketplace | |
| | c) Restart Docker Desktop | |
| | d) Reboot | |
| 8.7 | Tab through the dialog | All links and buttons (including "View the troubleshooting guide" and "Close") are reachable |
| 8.8 | Press Enter on "View the troubleshooting guide" | Opens GitHub troubleshooting URL in browser |
| 8.9 | Press Escape or Tab to "Close" and press Enter | Dialog closes; focus returns to the triggering element |

Restore the controller:

```shell
docker start imds-proxy-controller
```

| # | Action | Expected |
|---|--------|----------|
| 8.10 | Extension recovers | Alert disappears cleanly without flickering back |

---

## 9. Settings tab

Automated in `ui/src/__tests__/browser/settings.browser.test.tsx` and the
keyboard checks in `a11y.browser.test.tsx` (9.10-9.14).

| # | Action | Expected |
|---|--------|----------|
| 9.9 | Navigate to Containers tab, return to Settings | Saved URL still shown |

### External settings update (polling)

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

9.15 (the external update landing in the field) has no automated coverage.
9.16 has a disabled test: `settings.browser.test.tsx` has
`test.skip("a settings poll does not overwrite text being typed", ...)`,
reproducing issue #77, where a poll response that resolves while the user has
since started typing overwrites their keystrokes. It stays here, marked as
disabled pending that fix, rather than being deleted or run as-is.

| # | Action | Expected |
|---|--------|----------|
| 9.15 | Run the command while on the Settings tab | URL field updates to `http://localhost:9999` within ~5 seconds with no skeleton flicker |
| 9.16 | Edit the URL field (leave unsaved), run the external update | External change does NOT overwrite the unsaved edit. **Automation disabled**: covered by a `test.skip` in `settings.browser.test.tsx` pending issue #77. |

---

## 10. Documentation link

The browser suite can assert that `host.openExternal` is called with the
correct URL, but not that Docker Desktop actually opens it in the system
browser rather than inside itself. Stays manual.

| # | Action | Expected |
|---|--------|----------|
| 10.1 | Click "View documentation" in the header | GitHub repo opens in the system browser (not inside Docker Desktop) |
| 10.2 | Tab to "View documentation", press Enter | Same result as click |
| 10.3 | Tab to "View documentation", press Space | No navigation (correct - Space does not activate links, only Enter does) |

---

## 11. Snackbar behavior

Automated in `ui/src/__tests__/browser/appearance.browser.test.tsx`.

---

## 12. Light/dark mode

`ui/src/__tests__/browser/appearance.browser.test.tsx` proves the app renders
under each `prefers-color-scheme` and that the scheme signal reaches the
page, using stub theme objects (`window.__ddMuiV6Themes` set to empty
objects). It proves nothing about actual colours, contrast, or focus ring
visibility, which stay manual (also listed in the checklist at the top of
this document).

Switch in Docker Desktop → Settings → Appearance.

| # | Action | Expected |
|---|--------|----------|
| 12.1 | Switch to light mode | All text, backgrounds, and alerts render legibly |
| 12.2 | Switch to dark mode | Same check |
| 12.3 | Warning/error alerts readable in both modes | |
| 12.4 | Focus rings visible in both modes | Keyboard focus indicators are clearly visible against the background |

---

## 13. Proxy traffic (functional end-to-end)

Needs no GUI; belongs to `scripts/test-e2e.sh`, not this plan or the browser
suite.

Requires the `mendhak/http-https-echo` container running (see Prerequisites) and the extension URL set to `http://localhost:8080`.

```shell
# IPv4 (AWS/GCP)
docker exec test-imds-1 wget -qO- --timeout=5 http://169.254.169.254/status

# IPv6 EC2
docker exec test-imds-1 wget -qO- --timeout=5 http://[fd00:ec2::254]/status

# IPv6 OpenStack
docker exec test-imds-1 wget -qO- --timeout=5 http://[fd00:a9fe:a9fe::254]/status

# Unlabeled container - should fail
docker run --rm alpine wget -qO- --timeout=3 http://169.254.169.254/status
```

| # | Action | Expected |
|---|--------|----------|
| 13.1 | IPv4 request from labeled container | Response from IMDS server |
| 13.2 | IPv6 EC2 request from labeled container | Response from IMDS server |
| 13.3 | IPv6 OpenStack request from labeled container | Response from IMDS server |
| 13.4 | Any request from unlabeled container | Connection refused or no route to host |

---

## Platform-specific notes

**macOS:** Verify Docker Desktop VM networking; IPv6 addresses are routed inside the VM.

**Windows:** Docker Desktop requires WSL 2 mode. Verify clipboard copy lands in the Windows clipboard. The `docker exec ... curl` command (section 9) may need to be run from PowerShell rather than WSL to avoid socket path translation issues.

**Linux:** Docker Desktop uses a VM; IMDS networks are created inside it, not on the host. `docker network ls` on the host should still show them via the Docker socket.
