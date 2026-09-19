# UI test harness design

Status: approved, not yet implemented
Date: 2026-09-19

## Problem

`docs/manual-test-plan.md` is 351 lines across 13 sections, all executed by hand
before a release. Nothing about the UI is verified automatically: CI runs
`make test` and `pnpm build`, so the UI's only automated coverage is vitest
component tests against jsdom.

That gap has already cost us. A review of the UI found several defects that
ship green today, all of which are reachable only by driving the running app
with a backend that misbehaves:

- A malformed `/containers` response bypasses the "backend unreachable" state
  machine and fires a non-dismissable error snackbar on every poll tick.
- Both response type guards check shape, not content, and there is no error
  boundary, so one bad field blanks the panel.
- A settings poll can overwrite text the user is actively typing.

None of these are reachable from a component test, because they depend on the
real app's polling loop meeting a hostile payload.

## Goals

- Automate the UI-only sections of the manual test plan so they run on every PR.
- Make error states trivially reachable, so the bug class above is covered.
- Give an agent a precise way to drive and inspect the UI during development.

## Non-goals

- Replacing the manual test plan entirely. A short human smoke list remains for
  the real extension (see Coverage).
- Testing the real Docker Desktop integration. See "Out of scope".
- Testing against the real backend. See "Deferred: real-backend mode".

## Design

### What the browser actually needs (verified)

Loading the UI in Chrome against `pnpm dev` was tested directly. Findings:

The one hard blocker is a theme global, not the extension API. `@docker/docker-mui-theme`'s
`DockerMuiV6ThemeProvider` reads `window.__ddMuiV6Themes[dark|light]` with no
guard, so without it the whole tree throws
`TypeError: Cannot read properties of undefined (reading 'dark')` and the page
renders blank. Supplying `window.__ddMuiV6Themes = { light: {}, dark: {} }`
before the app mounts is enough; MUI's `createTheme` fills in defaults.

With that global present the entire UI renders in a plain browser: both tabs,
the label affordance, the containers table and its empty state. Missing
`ddClient` does not break anything, because `useDockerDesktopClient`
(`App.tsx:72`) already wraps `createDockerDesktopClient()` in try/catch and
surfaces the failure as a snackbar reading "Are you using this extension in a
browser?". The app degrades gracefully on its own.

Two details Docker Desktop supplies that the harness should mimic: it loads the
UI with query parameters (`platform`, `arch`, `hostname`, `extension`), and
`dialog=true` makes the theme provider swap the default background for the paper
colour.

This also reproduced the missing error boundary from the UI review. React logged
"Consider adding an error boundary" and the user saw an empty page with no
explanation, which is exactly the predicted failure.

### The shim

The UI touches exactly four Docker Desktop APIs:

| API | Used by |
|---|---|
| `extension.vm.service.get(path)` | `dockerDesktopService.ts` (`/settings`, `/containers`, `/compose-project-name`) |
| `extension.vm.service.post(path, body)` | `SettingsForm.tsx` (`/settings`) |
| `docker.cli.exec(cmd, args)` | `App.tsx` (proxy container start/unpause/compose) |
| `host.openExternal(url)` | `App.tsx` (docs links) |

The shim implements those four against an in-memory state object. It is
installed in place of `createDockerDesktopClient()` when running under the
harness, and nowhere else.

### Control plane

State is driven through `window.__harness`, exposed by the shim:

```js
window.__harness.setContainers([...])
window.__harness.setSettings({ url, customIPs })
window.__harness.failNext('/containers', { status: 500 })
window.__harness.respondWith('/containers', 'not-an-object')
window.__harness.setProxyState('paused')
```

No server, no Vite middleware, no HTTP control endpoint.

Playwright reaches this directly, because `page.evaluate` runs in the page's own
world. An agent driving Chrome through the Claude extension does not: that
JavaScript runs in an isolated world which shares the DOM but not JS globals, so
`window.__harness` is invisible to it. Verified by probing for a page-world
global and getting `undefined`.

The harness therefore also needs a DOM-based bridge for that case. Injecting a
`<script>` element whose text runs in the page world works and was verified;
results come back through the DOM. Whichever form it takes, it must be a
documented part of the harness rather than something each caller reinvents,
since the failure mode is silent: setting a global appears to succeed and simply
has no effect.

### Keeping the shim out of production

A build-output test, not a convention. After `vite build`, a vitest case greps
the emitted bundle for the harness symbols and fails if any are present. An
`import.meta.env.DEV` guard alone can regress silently, and this repo has no
lint rule that would catch it, so the guarantee is verified on every CI run.

### CI

A new job installs Chromium (`playwright install --with-deps chromium`) and runs
the suite headless. This is the largest cost in the phase: a net-new dependency
plus roughly 300MB of browser download, adding a minute or two of wall clock.
The repo has no browser driver today (jsdom only) and CI installs no browser.

## Coverage

Automated by this harness:

| Section | What it covers |
|---|---|
| 1, 2 | Initial load, empty state |
| 3 | Label copy affordance |
| 4 | Containers tab with labeled containers, keyboard access |
| 5 | Network connectivity chips |
| 6 | Sorting |
| 7a-d | Proxy container alerts: stopped, paused, crashed, missing |
| 8 | Backend unreachable |
| 9 | Settings tab, validation, polling behavior |
| 11 | Snackbar behavior |
| 12 | Light/dark mode |

Remains manual, as a short smoke list:

- Section 10, that a documentation link actually opens a browser. The harness can
  assert `host.openExternal` was called with the right URL; it cannot verify that
  Docker Desktop honours the call.
- The extension tab chrome and its placement in Docker Desktop.
- That the real `@docker/extension-api-client` transport still matches the shim.

Section 13 (proxy traffic, end-to-end) needs no GUI and is better served by
`scripts/test-e2e.sh` once its stale `.imds-0` network names are fixed.

## Out of scope: driving the real Docker Desktop window

Verification here is browser-only. Driving the real extension window with
`xdotool` is a separate concern with a separate purpose: debugging, not
regression coverage.

The distinction matters for where each one lives. A verification harness that
CI never runs rots silently and still reports success, which is how
`scripts/test-e2e.sh` kept greping for `.imds-0` through two network renames.
A debugging aid has no such failure mode, because nothing depends on it for a
pass/fail signal and it breaks in front of whoever is using it.

Driving it on the host desktop directly is not possible on this machine, but a
nested X server solves it. Both were established by testing. Recorded here so
neither is retried from scratch.

Docker Desktop 4.80.0 (Electron 41.4.0) runs its window as a native Wayland
client: the GUI process holds Wayland sockets and no X11 socket, and it does
not appear in `xlsclients`, so `xdotool` cannot see or drive it. Two ways to
change that were tried and both failed for the same underlying reason, which is
that Docker Desktop controls its own Electron launch:

- `ELECTRON_OZONE_PLATFORM_HINT=x11`, delivered through a user-level systemd
  drop-in, is correctly inherited by the GUI process and does nothing. Verified
  with a window open: still 2 Wayland sockets, 0 X11. Upstream explains why: the
  variable was deprecated in Electron 38 and removed in Electron 39
  (electron/electron#48001), because from Chromium 140 the ozone default became
  `auto`. Docker Desktop ships Electron 41, so the variable is simply gone. In
  its last working form it was an alias for `XDG_SESSION_TYPE`, which is
  `wayland` here, so auto-detection picks Wayland either way.
- `--remote-debugging-port` cannot be injected. The systemd unit starts
  `com.docker.backend`, and the backend spawns the GUI with a fixed argument
  list. Launching the Electron binary by hand does open a working CDP endpoint,
  but the GUI never creates a window without the backend's handshake, so there
  are no targets to attach to.

Both therefore reduce to the same blocker: injecting an argument into a process
that `com.docker.backend` spawns. `--ozone-platform` on the command line does
take precedence over whatever an app sets in code (electron/electron#33810), so
forcing X11 is possible in principle; there is just no supported way to get the
argument there. Doing it anyway means replacing the binary under
`/opt/docker-desktop` with a wrapper, which needs root and would be clobbered by
Docker Desktop updates. That is not a reasonable trade for a debugging aid.

**What does work: a nested X server.** Ubuntu 26.04 ships GNOME 50, which removed
the X11 session entirely, so there is no Xorg option at the login screen and no
config brings it back. But only Docker Desktop needs to be on X11, not the whole
desktop. Run `Xephyr :2 -screen 1600x1000 -ac`, then give the service a drop-in:

    [Service]
    Environment=DISPLAY=:2
    Environment=XDG_SESSION_TYPE=x11
    UnsetEnvironment=WAYLAND_DISPLAY

Ozone auto-detection then picks X11. Verified end to end: Docker Desktop renders
into the nested display, `xdotool -display :2` lists its windows, clicks land on
the right controls, and ImageMagick's `import` captures them.

It also exposes the extension webview as its own X window titled
`extension - Docker Desktop`, separate from `dashboard`. Capturing and clicking
that window gives coordinates relative to the extension rather than the whole
desktop, which removes most of the brittleness screenshot-guided clicking
usually carries.

The desktop session stays on GNOME throughout, and the whole thing reverses by
deleting the drop-in and restarting the service. Xephyr is software-rendered, so
Docker Desktop feels slow: this is a tool to switch on while debugging, not to
leave running.

For debugging the real extension, Docker supports three things that need none of
the above, all human-driven:

- `docker extension dev debug <ext>` opens Chrome DevTools each time the
  extension tab is selected. `docker extension dev reset <ext>` undoes it.
- Within the extension tab, the key sequence up, up, down, down, left, right,
  left, right, p, d, t opens DevTools directly.
- `docker extension dev ui-source <ext> http://localhost:3000` points the real
  extension at a dev server.

That last one matters for this design: the same Vite server can serve both the
browser harness and the real extension tab, so the smoke list exercises the same
bundle the automated suite does, rather than a separate build.

Worth knowing for expectations: Docker documents no automated or end-to-end
testing story for extension UIs at all, and published extensions test with
Vitest and React Testing Library against jsdom, which is what this repo already
does. A browser-driven suite puts this repo ahead of common practice for Docker
extensions rather than catching it up.

## Deferred: real-backend mode

Pointing the shim at the real controller is blocked on infrastructure, not
effort. The controller runs inside the Docker Desktop VM with
`network_mode: none`, serving a Unix socket at
`/run/guest-services/backend.sock`; a browser on the host cannot reach it.
Closing that needs either a dev-only compose override that publishes a port, or
a TCP listener added to production code. The second means changing how the
shipped artifact runs in order to test it, which deserves its own decision
rather than being folded into this work.

Revisit once the browser suite exists and the remaining gap is measurable.

## Testing

The harness is itself test infrastructure, so it is verified by the suite it
enables plus two specific checks:

- The build-output test described above.
- A test asserting the shim's method signatures match the subset of
  `@docker/extension-api-client` the UI uses, so the shim cannot silently drift
  from the real API and give false confidence.

## Files

- `ui/src/dev/harness.ts`: shim and `window.__harness`
- `ui/e2e/*.spec.ts`: Playwright specs, one per test-plan section
- `ui/e2e/fixtures.ts`: container and settings fixtures
- `.github/workflows/ci.yml`: new job
- `DEVELOPMENT.md`: how to run it
- `docs/manual-test-plan.md`: reduced to the smoke list, pointing here
