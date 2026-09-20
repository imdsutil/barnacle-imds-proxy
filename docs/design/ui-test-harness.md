# UI test harness design

Status: implemented. Designed 2026-09-19.

The design below is the record of why the harness looks the way it does. For
how to run the tests, and for which tool covers what, see `DEVELOPMENT.md`.

## Problem

Before this work, `docs/manual-test-plan.md` was a 351-line checklist executed
by hand before every release, and nothing about the UI was verified
automatically. CI ran `make test` and `pnpm build`, so the UI's only automated
coverage was vitest component tests against jsdom.

That gap had already cost us. A review of the UI found several defects that
shipped green, all of them reachable only by driving the running app with a
backend that misbehaves:

- A malformed `/containers` response bypasses the "backend unreachable" state
  machine and fires a non-dismissable error snackbar on every poll tick.
- Both response type guards check shape, not content, and there is no error
  boundary, so one bad field blanks the panel.
- A settings poll can overwrite text the user is actively typing.

None of these are reachable from a component test, because they depend on the
real app's polling loop meeting a hostile payload.

## Goals

- Automate the UI-only parts of the manual test plan so they run on every PR.
- Make error states trivially reachable, so the bug class above is covered.
- Give an agent a precise way to drive and inspect the UI during development.

## Non-goals

- Replacing the manual test plan entirely. A short human smoke list remains for
  the real extension.
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

### The fake client

The UI touches exactly four Docker Desktop APIs:

| API | Used by |
|---|---|
| `extension.vm.service.get(path)` | `dockerDesktopService.ts` (`/settings`, `/containers`, `/compose-project-name`) |
| `extension.vm.service.post(path, body)` | `SettingsForm.tsx` (`/settings`) |
| `docker.cli.exec(cmd, args)` | `App.tsx` (proxy container start/unpause/compose) |
| `host.openExternal(url)` | `App.tsx` (docs links) |

`createFakeDdClient()` implements those four against an in-memory state object
and adds the controls a test needs: `setContainers`, `setSettings`,
`setProxyStatus`, `failNext` (fail one request), `failAlways` and
`clearFailAlways` (fail every request until cleared, which is what reaching the
unreachable threshold requires), plus the `savedSettings`, `openedUrls` and
`execCalls` spies.

An unrecognised GET throws rather than returning a default, so a test that
drives the app down an unmodelled path fails loudly instead of silently
passing against an empty response.

### Wiring it in

The original design routed state through a page-world global,
`window.__harness`, on the assumption that the driver would be an out-of-process
Playwright script. That turned out to be unnecessary. Vitest browser mode runs
the test file inside the browser alongside the app, so the fake is passed
straight to the component tree with no bridge at all:

```ts
const fake = createFakeDdClient({ proxyStatus: "paused" });
const screen = await renderApp(fake);
```

`renderApp` mocks `createDockerDesktopClient()` to return the fake and wraps
`App` in `DockerMuiV6ThemeProvider`. `vite.config.ts` aliases
`@docker/extension-api-client` to a local mock whenever `VITEST` is set, which
is what makes that mock possible; the alias is absent from a production build.
The theme global from the section above is seeded in `beforeEach`.

Two suites share one config through vitest projects: `unit` (jsdom, the
pre-existing component tests) and `browser` (real Chromium via
`@vitest/browser-playwright`). `pnpm test` runs both.

Recorded so it is not retried: a page-world global would not have worked for an
agent driving Chrome through the Claude extension anyway. That JavaScript runs
in an isolated world which shares the DOM but not JS globals, so
`window.__harness` is invisible to it. Verified by probing for a page-world
global and getting `undefined`.

### Keeping the harness out of production

A build-output test, not a convention. `noHarnessInBuild.test.ts` runs
`pnpm build` and greps the emitted bundles for harness markers.

The markers have to be chosen for what survives esbuild. Identifiers are
mangled, so grepping for `createFakeDdClient` proves nothing; string literals
and property accesses survive, so the test looks for the literal
`fake: unexpected GET` and for `__ddMuiV6Themes = {`. The assignment pattern
matters: the production theme provider reads that global, so a bare name match
would fire on shipped code.

The same test asserts the marker is present in the harness source, so the guard
cannot quietly start passing because the string it looks for was renamed.

### CI

No separate job. The existing `test` job gained a cached
`playwright install chromium --with-deps` step, and `make test` reaches the
browser suite through `make test-ui-coverage`, which runs both vitest projects.
Scoping that target to `--project=unit` for speed would drop the browser suite
from CI without failing anything, so the Makefile carries a comment saying so.

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

That last one is how the manual smoke list is run against work in progress:
point the real extension tab at `pnpm dev` and it picks up the same source the
browser suite compiles, without a rebuild between each change. The browser suite
itself does not use that server; vitest builds and serves its own page.

Worth knowing for expectations: Docker documents no automated or end-to-end
testing story for extension UIs at all, and published extensions test with
Vitest and React Testing Library against jsdom, which is what this repo already
does. A browser-driven suite puts this repo ahead of common practice for Docker
extensions rather than catching it up.
## Deferred: real-backend mode

Pointing the fake at the real controller is blocked on infrastructure, not
effort. The controller runs inside the Docker Desktop VM with
`network_mode: none`, serving a Unix socket at
`/run/guest-services/backend.sock`; a browser on the host cannot reach it.
Closing that needs either a dev-only compose override that publishes a port, or
a TCP listener added to production code. The second means changing how the
shipped artifact runs in order to test it, which deserves its own decision
rather than being folded into this work.

Revisit now that the browser suite exists and the remaining gap is measurable.

## Known gaps

The fake's method signatures are hand-written and are handed to the mock as
`never`, so TypeScript will not catch it drifting from the real
`@docker/extension-api-client`. A signature-conformance test was part of the
original design and was not built. Until it is, an upstream API change shows up
as a green suite and a broken extension.

## Files

- `ui/src/__tests__/browser/fakeDdClient.ts`: the fake client and its controls
- `ui/src/__tests__/browser/renderApp.tsx`: mounts `App` against a fake
- `ui/src/__tests__/browser/setup.ts`: theme global, mock reset between tests
- `ui/src/__tests__/browser/*.browser.test.tsx`: the suites
- `ui/src/__tests__/__mocks__/extension-api-client.ts`: the aliased module
- `ui/src/__tests__/noHarnessInBuild.test.ts`: build-output guard
- `ui/vite.config.ts`: the two vitest projects and the test-only alias
