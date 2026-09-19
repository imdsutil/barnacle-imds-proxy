# UI Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the UI-only sections of `docs/manual-test-plan.md` so they run on every PR, leaving a three item human smoke list.

**Architecture:** Vitest browser mode renders the real `App` in a real Chromium. A controllable fake supplies the four Docker Desktop APIs the UI uses, and a setup file supplies the theme global the MUI provider reads. Browser tests live in their own vitest project alongside the existing jsdom suite, so both run from one runner and one CI job.

**Tech Stack:** vitest 4.1.11 (already present), `@vitest/browser` with the Playwright provider, React 18, MUI.

**Spec:** `docs/design/2026-09-19-ui-test-harness.md`

## Global Constraints

- Node 22, pnpm 10. Go 1.25. These match `.github/workflows/ci.yml`.
- vitest and `@vitest/coverage-v8` are pinned at `^4.1.11`. `@vitest/browser` must match exactly.
- Coverage thresholds are 80% for lines, functions, branches and statements (`ui/vite.config.ts`). Browser tests must not drop any below 80.
- Every new source file needs the Apache 2.0 header. The `addlicense` pre-commit hook enforces it; copy the header verbatim from `ui/src/App.tsx`.
- Conventional Commits for every commit, no exceptions.
- No em dashes in any file or commit message.
- The harness must never ship in a production build. Task 9 enforces this with a test.

## Deviation from the spec

The spec proposes `window.__harness` as a runtime control plane reached by `page.evaluate` or by injecting a script tag. That design assumed driving a running dev server.

Vitest browser mode mounts components directly, so a test controls the fake by importing it. `window.__harness` is therefore not built here. It remains the right design for interactive agent-driven debugging against a dev server, which is not this phase's goal.

## Known-failing behaviour

Four behaviours the spec wants covered are currently broken, tracked in issues #64 and #65. Tests for them are written in this plan but marked `.skip` with the issue number in a comment, so the suite lands green and the fix PR just removes the `.skip`. Do not "fix" the component to make them pass; that is separate work.

## File structure

| File | Responsibility |
|---|---|
| `ui/src/__tests__/browser/setup.ts` | Supplies `window.__ddMuiV6Themes` before any render |
| `ui/src/__tests__/browser/fakeDdClient.ts` | Controllable fake for the four Docker Desktop APIs |
| `ui/src/__tests__/browser/renderApp.tsx` | Mounts `App` with the fake, one helper used by every test |
| `ui/src/__tests__/browser/containers.browser.test.tsx` | Test plan sections 1, 2, 3, 4, 6 |
| `ui/src/__tests__/browser/proxyState.browser.test.tsx` | Sections 5, 7a-d, 8 |
| `ui/src/__tests__/browser/settings.browser.test.tsx` | Section 9 |
| `ui/src/__tests__/browser/appearance.browser.test.tsx` | Sections 11, 12 |
| `ui/src/__tests__/noHarnessInBuild.test.ts` | Asserts the fake never reaches a production bundle |
| `ui/vite.config.ts` | Adds the browser test project |
| `.github/workflows/ci.yml` | Installs Chromium, runs the browser suite |
| `Makefile` | `test-ui-browser` target, folded into `test` |
| `docs/manual-test-plan.md` | Reduced to the three item smoke list |
| `DEVELOPMENT.md` | How to run and debug the browser suite |

---

### Task 1: Get one browser test running

Proves the whole setup end to end before any real test is written: the browser provider, the theme global, and that `App` mounts without the Docker Desktop host.

**Files:**
- Modify: `ui/package.json`
- Modify: `ui/vite.config.ts`
- Create: `ui/src/__tests__/browser/setup.ts`
- Create: `ui/src/__tests__/browser/smoke.browser.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a vitest project named `browser` that matches `src/__tests__/browser/**/*.browser.test.tsx`, run with `pnpm test --project=browser`.

- [ ] **Step 1: Install the browser provider**

```bash
cd ui && pnpm add -D @vitest/browser@4.1.11 playwright@latest
pnpm exec playwright install chromium --with-deps
```

- [ ] **Step 2: Write the theme setup file**

`DockerMuiV6ThemeProvider` reads `window.__ddMuiV6Themes[dark|light]` with no guard. Without it every render throws `TypeError: Cannot read properties of undefined (reading 'dark')` and the page is blank. `createTheme` fills in defaults from an empty object.

Create `ui/src/__tests__/browser/setup.ts` (Apache header first, copied from `ui/src/App.tsx`):

```ts
import { beforeEach } from "vitest";

declare global {
  interface Window {
    __ddMuiV6Themes?: Record<string, object>;
    __ddMuiV5Themes?: Record<string, object>;
  }
}

beforeEach(() => {
  window.__ddMuiV6Themes = { light: {}, dark: {} };
  window.__ddMuiV5Themes = { light: {}, dark: {} };
});
```

- [ ] **Step 3: Add the browser project to vite.config.ts**

Replace the existing `test: { ... }` block's contents by wrapping them in `projects`. Keep every existing option for the jsdom project exactly as it is, including `coverage` and `alias`.

```ts
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/__tests__/setup.ts"],
          include: ["src/__tests__/**/*.test.{ts,tsx}"],
          exclude: ["src/__tests__/browser/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          globals: true,
          setupFiles: ["./src/__tests__/browser/setup.ts"],
          include: ["src/__tests__/browser/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage",
      exclude: [
        "src/main.tsx",
        "src/__tests__/**",
        "src/**/__mocks__/**",
        "**/*.d.ts",
        "vite.config.ts",
        "build/**",
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
```

Note the existing top-level `resolve.alias` for `@docker/extension-api-client` is keyed on `isTest` and still applies, because `extends: true` inherits the root config.

- [ ] **Step 4: Write the failing smoke test**

Create `ui/src/__tests__/browser/smoke.browser.test.tsx` (Apache header first):

```tsx
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { DockerMuiV6ThemeProvider } from "@docker/docker-mui-theme";
import { App } from "../../App";

test("App mounts in a real browser without a Docker Desktop host", async () => {
  const screen = render(
    <DockerMuiV6ThemeProvider>
      <App />
    </DockerMuiV6ThemeProvider>
  );

  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});
```

Install the render helper:

```bash
cd ui && pnpm add -D vitest-browser-react
```

- [ ] **Step 5: Run it and watch it fail**

Run: `cd ui && pnpm test --project=browser`
Expected: FAIL. Most likely the browser project is not picked up, or Chromium is missing. Fix the configuration until it fails on the assertion rather than on setup, then make it pass.

- [ ] **Step 6: Run it and watch it pass**

Run: `cd ui && pnpm test --project=browser`
Expected: PASS, 1 test.

Then confirm the existing suite is untouched:

Run: `cd ui && pnpm test --project=unit`
Expected: PASS, 67 tests.

- [ ] **Step 7: Commit**

```bash
git add ui/package.json ui/pnpm-lock.yaml ui/vite.config.ts ui/src/__tests__/browser/
git commit -m "test: run the UI in a real browser under vitest browser mode"
```

---

### Task 2: The controllable fake

**Files:**
- Create: `ui/src/__tests__/browser/fakeDdClient.ts`
- Create: `ui/src/__tests__/browser/renderApp.tsx`
- Modify: `ui/src/__tests__/browser/smoke.browser.test.tsx`

**Interfaces:**
- Consumes: the `browser` project from Task 1.
- Produces:
  - `createFakeDdClient(initial?: Partial<FakeState>): FakeDdClient`
  - `FakeState` with fields `settings: unknown`, `containers: unknown`, `proxyStatus: string`, `failGet: Record<string, number | undefined>`
  - `fake.setContainers(value: unknown): void`
  - `fake.setSettings(value: unknown): void`
  - `fake.failNext(path: string, status: number): void`
  - `fake.savedSettings: unknown[]` recording every POST
  - `renderApp(fake: FakeDdClient)` returning vitest-browser-react's screen object

- [ ] **Step 1: Write the failing test for the fake**

Add to `ui/src/__tests__/browser/smoke.browser.test.tsx`:

```tsx
import { createFakeDdClient } from "./fakeDdClient";

test("the fake records saved settings and serves what it is given", async () => {
  const fake = createFakeDdClient({ settings: { url: "http://x:1", customIPs: [] } });

  const got = await fake.extension.vm.service.get("/settings");
  expect(got).toEqual({ url: "http://x:1", customIPs: [] });

  await fake.extension.vm.service.post("/settings", { url: "http://y:2", customIPs: [] });
  expect(fake.savedSettings).toEqual([{ url: "http://y:2", customIPs: [] }]);
});

test("failNext makes exactly one request reject", async () => {
  const fake = createFakeDdClient();
  fake.failNext("/containers", 500);

  await expect(fake.extension.vm.service.get("/containers")).rejects.toThrow();
  await expect(fake.extension.vm.service.get("/containers")).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && pnpm test --project=browser`
Expected: FAIL with a resolution error for `./fakeDdClient`.

- [ ] **Step 3: Write the fake**

Create `ui/src/__tests__/browser/fakeDdClient.ts` (Apache header first):

```ts
export interface FakeState {
  settings: unknown;
  containers: unknown;
  proxyStatus: string;
}

export interface FakeDdClient {
  extension: {
    vm: { service: { get(path: string): Promise<unknown>; post(path: string, body: unknown): Promise<unknown> } };
  };
  docker: { cli: { exec(cmd: string, args: string[]): Promise<{ stdout: string }> } };
  host: { openExternal(url: string): void };
  setContainers(value: unknown): void;
  setSettings(value: unknown): void;
  setProxyStatus(value: string): void;
  failNext(path: string, status: number): void;
  savedSettings: unknown[];
  openedUrls: string[];
  execCalls: string[];
}

export function createFakeDdClient(initial: Partial<FakeState> = {}): FakeDdClient {
  const state: FakeState = {
    settings: initial.settings ?? { url: "", customIPs: [] },
    containers: initial.containers ?? { containers: [], proxyStatus: "running" },
    proxyStatus: initial.proxyStatus ?? "running",
  };
  const failures: Record<string, number | undefined> = {};
  const savedSettings: unknown[] = [];
  const openedUrls: string[] = [];
  const execCalls: string[] = [];

  const maybeFail = (path: string) => {
    const status = failures[path];
    if (status !== undefined) {
      delete failures[path];
      throw new Error(`fake: ${path} failed with ${status}`);
    }
  };

  return {
    extension: {
      vm: {
        service: {
          async get(path: string) {
            maybeFail(path);
            if (path === "/settings") return state.settings;
            if (path === "/containers") {
              const value = state.containers as Record<string, unknown>;
              if (value && typeof value === "object" && "containers" in value) {
                return { ...value, proxyStatus: state.proxyStatus };
              }
              return value;
            }
            if (path === "/compose-project-name") return { projectName: "", configFiles: "" };
            throw new Error(`fake: unexpected GET ${path}`);
          },
          async post(path: string, body: unknown) {
            maybeFail(path);
            if (path === "/settings") {
              savedSettings.push(body);
              state.settings = body;
              return { ok: true };
            }
            throw new Error(`fake: unexpected POST ${path}`);
          },
        },
      },
    },
    docker: {
      cli: {
        async exec(cmd: string, args: string[]) {
          execCalls.push([cmd, ...args].join(" "));
          return { stdout: "" };
        },
      },
    },
    host: {
      openExternal(url: string) {
        openedUrls.push(url);
      },
    },
    setContainers(value: unknown) {
      state.containers = value;
    },
    setSettings(value: unknown) {
      state.settings = value;
    },
    setProxyStatus(value: string) {
      state.proxyStatus = value;
    },
    failNext(path: string, status: number) {
      failures[path] = status;
    },
    savedSettings,
    openedUrls,
    execCalls,
  };
}
```

- [ ] **Step 4: Write the render helper**

`App` calls `createDockerDesktopClient()` itself, so the fake is injected through the existing alias. Create `ui/src/__tests__/browser/renderApp.tsx` (Apache header first):

```tsx
import { vi } from "vitest";
import { render } from "vitest-browser-react";
import { DockerMuiV6ThemeProvider } from "@docker/docker-mui-theme";
import { createDockerDesktopClient } from "@docker/extension-api-client";
import { App } from "../../App";
import type { FakeDdClient } from "./fakeDdClient";

export function renderApp(fake: FakeDdClient) {
  vi.mocked(createDockerDesktopClient).mockReturnValue(fake as never);
  return render(
    <DockerMuiV6ThemeProvider>
      <App />
    </DockerMuiV6ThemeProvider>
  );
}
```

The alias in `vite.config.ts` already points `@docker/extension-api-client` at `src/__tests__/__mocks__/extension-api-client.ts`, which exports `createDockerDesktopClient = vi.fn()`.

- [ ] **Step 5: Run and watch pass**

Run: `cd ui && pnpm test --project=browser`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add ui/src/__tests__/browser/
git commit -m "test: add a controllable Docker Desktop fake for browser tests"
```

---

### Task 3: Containers tab (test plan sections 1, 2, 3, 4, 6)

**Files:**
- Create: `ui/src/__tests__/browser/containers.browser.test.tsx`

**Interfaces:**
- Consumes: `createFakeDdClient`, `renderApp` from Task 2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing tests**

```tsx
import { expect, test } from "vitest";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

const container = (name: string, id: string, ip = "169.254.169.254") => ({
  name,
  id,
  labels: { "imds-proxy.enabled": "true" },
  addresses: [{ address: ip, connected: true }],
  networks: [],
});

test("empty state tells the user no labeled containers are running", async () => {
  const screen = renderApp(createFakeDdClient());
  await expect.element(screen.getByText("No labeled containers are running.")).toBeVisible();
});

test("the enabling label is shown so it can be copied", async () => {
  const screen = renderApp(createFakeDdClient());
  await expect.element(screen.getByText("imds-proxy.enabled=true")).toBeVisible();
});

test("labeled containers are listed with their id", async () => {
  const fake = createFakeDdClient({
    containers: { containers: [container("alpha", "aaaaaaaaaaaa")], proxyStatus: "running" },
  });
  const screen = renderApp(fake);
  await expect.element(screen.getByText("alpha")).toBeVisible();
  await expect.element(screen.getByText("aaaaaaaaaaaa")).toBeVisible();
});

test("containers sort by name", async () => {
  const fake = createFakeDdClient({
    containers: {
      containers: [container("zeta", "zzzzzzzzzzzz"), container("alpha", "aaaaaaaaaaaa")],
      proxyStatus: "running",
    },
  });
  const screen = renderApp(fake);
  await expect.element(screen.getByText("alpha")).toBeVisible();
  const rows = await screen.container.querySelectorAll("tbody tr");
  expect(rows[0].textContent).toContain("alpha");
});

test("a configured IMDS address is shown for each container", async () => {
  const fake = createFakeDdClient({
    containers: { containers: [container("alpha", "aaaaaaaaaaaa")], proxyStatus: "running" },
  });
  const screen = renderApp(fake);
  await expect.element(screen.getByText("169.254.169.254")).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm which fail**

Run: `cd ui && pnpm test --project=browser`

Any failure here is a mismatch between the fake's container shape and what `ContainersTable.tsx` reads. Open `ui/src/components/ContainersTable.tsx` and `ui/src/types.ts` and correct the fixture shape, not the component. The component is the source of truth for what a container looks like.

- [ ] **Step 3: Run and watch pass**

Run: `cd ui && pnpm test --project=browser`
Expected: PASS, all of them.

- [ ] **Step 4: Commit**

```bash
git add ui/src/__tests__/browser/containers.browser.test.tsx
git commit -m "test: cover the containers tab in a real browser"
```

---

### Task 4: Proxy state and backend reachability (sections 5, 7a-d, 8)

**Files:**
- Create: `ui/src/__tests__/browser/proxyState.browser.test.tsx`

**Interfaces:**
- Consumes: `createFakeDdClient`, `renderApp`.
- Produces: nothing.

- [ ] **Step 1: Read the component first**

Open `ui/src/App.tsx` and find every distinct `proxyStatus` value it branches on, and what it renders for each. Use those exact strings in the tests below in place of the placeholders. Do not guess.

- [ ] **Step 2: Write the tests**

```tsx
import { expect, test } from "vitest";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

test.each(["stopped", "paused", "crashed", "missing"])(
  "proxy status %s produces a visible alert",
  async (status) => {
    const fake = createFakeDdClient({ containers: { containers: [], proxyStatus: status } });
    const screen = renderApp(fake);
    await expect.element(screen.getByRole("alert")).toBeVisible();
  }
);

test("a running proxy shows no alert", async () => {
  const fake = createFakeDdClient({ containers: { containers: [], proxyStatus: "running" } });
  const screen = renderApp(fake);
  await expect.element(screen.getByText("No labeled containers are running.")).toBeVisible();
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

// Skipped: reproduces issue #64's sibling defect at App.tsx:134. A malformed
// /containers response bypasses the unreachable state machine and fires a
// non-dismissable error snackbar on every poll tick. Remove .skip when fixed.
test.skip("a malformed containers response does not loop an undismissable error", async () => {
  const fake = createFakeDdClient({ containers: { totally: "wrong" } });
  const screen = renderApp(fake);
  await expect.element(screen.getByRole("alert")).toBeVisible();
});

// Skipped: issue #65. Both type guards are shape only and there is no error
// boundary, so one malformed element blanks the panel. Remove .skip when fixed.
test.skip("a malformed container element does not blank the panel", async () => {
  const fake = createFakeDdClient({ containers: { containers: [{}], proxyStatus: "running" } });
  const screen = renderApp(fake);
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});
```

- [ ] **Step 3: Run, fix fixtures, watch pass**

Run: `cd ui && pnpm test --project=browser`
Expected: PASS with 2 skipped. If an alert assertion fails, correct the status strings from Step 1.

- [ ] **Step 4: Commit**

```bash
git add ui/src/__tests__/browser/proxyState.browser.test.tsx
git commit -m "test: cover proxy container state alerts in a real browser"
```

---

### Task 5: Settings tab (section 9)

**Files:**
- Create: `ui/src/__tests__/browser/settings.browser.test.tsx`

**Interfaces:**
- Consumes: `createFakeDdClient`, `renderApp`.
- Produces: nothing.

- [ ] **Step 1: Write the tests**

```tsx
import { expect, test } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

async function openSettings(screen: ReturnType<typeof renderApp>) {
  await userEvent.click(screen.getByRole("tab", { name: /settings/i }));
}

test("an existing URL is shown when the tab opens", async () => {
  const fake = createFakeDdClient({ settings: { url: "http://localhost:8080", customIPs: [] } });
  const screen = renderApp(fake);
  await openSettings(screen);
  await expect.element(screen.getByDisplayValue("http://localhost:8080")).toBeVisible();
});

test("a typed URL is saved to the backend", async () => {
  const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
  const screen = renderApp(fake);
  await openSettings(screen);

  await userEvent.fill(screen.getByLabelText(/imds server url/i), "http://localhost:9000");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));

  await expect.poll(() => fake.savedSettings.length).toBe(1);
  expect((fake.savedSettings[0] as { url: string }).url).toBe("http://localhost:9000");
});

test("an invalid URL is rejected rather than saved", async () => {
  const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
  const screen = renderApp(fake);
  await openSettings(screen);

  await userEvent.fill(screen.getByLabelText(/imds server url/i), "not-a-url");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));

  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(fake.savedSettings).toHaveLength(0);
});

// Skipped: issue #64. The poll's dirty check runs before the await, so a
// response in flight overwrites text the user is typing. Reproduced against
// the real extension. Remove .skip when fixed.
test.skip("a settings poll does not overwrite text being typed", async () => {
  const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
  const screen = renderApp(fake);
  await openSettings(screen);

  const field = screen.getByLabelText(/imds server url/i);
  await userEvent.fill(field, "http://localhost:9000");
  await new Promise((r) => setTimeout(r, 6000));

  await expect.element(screen.getByDisplayValue("http://localhost:9000")).toBeVisible();
}, 15000);
```

- [ ] **Step 2: Run, correct the selectors, watch pass**

Run: `cd ui && pnpm test --project=browser`

If a label lookup fails, read `ui/src/components/SettingsForm.tsx` for the exact label text and button copy and use it verbatim.

Expected: PASS with 1 skipped.

- [ ] **Step 3: Commit**

```bash
git add ui/src/__tests__/browser/settings.browser.test.tsx
git commit -m "test: cover the settings tab in a real browser"
```

---

### Task 6: Snackbars and colour scheme (sections 11, 12)

**Files:**
- Create: `ui/src/__tests__/browser/appearance.browser.test.tsx`

**Interfaces:**
- Consumes: `createFakeDdClient`, `renderApp`.
- Produces: nothing.

- [ ] **Step 1: Write the tests**

```tsx
import { expect, test } from "vitest";
import { page } from "@vitest/browser/context";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

test("a backend failure surfaces a visible message", async () => {
  const fake = createFakeDdClient();
  fake.failNext("/containers", 500);
  const screen = renderApp(fake);
  await expect.element(screen.getByRole("alert")).toBeVisible();
});

test("the app renders under a dark colour scheme", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  const screen = renderApp(createFakeDdClient());
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});

test("the app renders under a light colour scheme", async () => {
  await page.emulateMedia({ colorScheme: "light" });
  const screen = renderApp(createFakeDdClient());
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});
```

Note these prove the app survives both schemes. They do not prove the colours are right, because the setup supplies stub theme objects rather than Docker Desktop's real ones. That gap is why the theme check is on the smoke list in Task 10.

- [ ] **Step 2: Run and watch pass**

Run: `cd ui && pnpm test --project=browser`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ui/src/__tests__/browser/appearance.browser.test.tsx
git commit -m "test: cover snackbars and colour schemes in a real browser"
```

---

### Task 7: Wire it into make and CI

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `browser` project.
- Produces: `make test-ui-browser`.

- [ ] **Step 1: Add the Makefile target**

Insert immediately before `test-ui:` in the Tests section:

```make
test-ui-browser: ## Run UI tests in a real browser (Chromium)
	@echo "$(INFO_COLOR)Running UI browser tests...$(NO_COLOR)"
	cd ui && pnpm test --project=browser
```

And add it to the aggregate target:

```make
test: test-coverage test-race test-stress test-scripts test-ui-browser ## Run all tests with coverage, race detection, and stress. Set VERBOSE_TESTS=1 to show detailed logs.
```

- [ ] **Step 2: Install Chromium in CI**

In `.github/workflows/ci.yml`, in the `test` job, immediately after the `Install bats` step:

```yaml
      - name: Install Playwright Chromium
        run: cd ui && pnpm exec playwright install chromium --with-deps
```

- [ ] **Step 3: Verify locally**

Run: `make test`
Expected: exit 0, with the browser tests included in the output.

- [ ] **Step 4: Commit**

```bash
git add Makefile .github/workflows/ci.yml
git commit -m "ci: run the UI browser suite on every PR"
```

---

### Task 8: Prove the fake cannot ship

**Files:**
- Create: `ui/src/__tests__/noHarnessInBuild.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

The fake lives under `__tests__` so it should never be bundled, but nothing enforces that and no lint rule here would catch a stray import. This asserts it on every CI run.

- [ ] **Step 1: Write the failing test**

```ts
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("the production bundle contains no harness code", () => {
  execSync("pnpm build", { cwd: process.cwd(), stdio: "pipe" });

  const assets = join(process.cwd(), "build", "assets");
  const bundles = readdirSync(assets).filter((f) => f.endsWith(".js"));
  expect(bundles.length).toBeGreaterThan(0);

  for (const file of bundles) {
    const source = readFileSync(join(assets, file), "utf8");
    expect(source).not.toContain("createFakeDdClient");
    expect(source).not.toContain("__ddMuiV6Themes = ");
  }
}, 120000);
```

- [ ] **Step 2: Run and watch it fail for the right reason**

Run: `cd ui && pnpm test --project=unit noHarnessInBuild`

If it passes immediately, it proves nothing yet. Temporarily add `import "./browser/fakeDdClient";` to `ui/src/App.tsx`, re-run, and confirm it fails. Then remove that import and confirm it passes again.

- [ ] **Step 3: Commit**

```bash
git add ui/src/__tests__/noHarnessInBuild.test.ts
git commit -m "test: assert harness code never reaches a production bundle"
```

---

### Task 9: Reduce the manual test plan

**Files:**
- Modify: `docs/manual-test-plan.md`
- Modify: `DEVELOPMENT.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Replace the automated sections**

Sections 1, 2, 3, 4, 5, 6, 7a-d, 8, 9, 11 and 12 are now covered by `ui/src/__tests__/browser/`. Replace each with a one line pointer to the covering file, keeping the section headings so existing links do not break.

Keep section 13 as it is; it needs no GUI and belongs to `scripts/test-e2e.sh`.

- [ ] **Step 2: Add the smoke list**

Add at the top of `docs/manual-test-plan.md`, after the title:

```markdown
## Before a release

Most of this plan is automated in `ui/src/__tests__/browser/`, run by `make test`.
Three things the browser suite cannot cover remain manual:

1. The extension tab appears in Docker Desktop and opens.
2. Settings save and reload correctly against the real backend, which proves the
   real `@docker/extension-api-client` transport still matches the fake.
3. Light and dark mode look right, which the suite cannot prove because it
   supplies stub theme objects rather than Docker Desktop's real ones.

`scripts/gui-debug.sh` drives the real extension if you want to do these without
clicking. The rest of this document is reference for what the suite covers.
```

- [ ] **Step 3: Document how to run it**

In `DEVELOPMENT.md`, under `## UI development`, after the existing `pnpm` block:

```markdown
Browser tests render the real app in Chromium:

```bash
cd ui
pnpm test --project=browser        # browser suite only
pnpm test --project=unit           # jsdom suite only
pnpm exec playwright install chromium --with-deps   # first run only
```

Tests marked `.skip` reference an open issue. Remove the `.skip` in the PR that fixes the issue rather than in a separate change.
```

- [ ] **Step 4: Verify and commit**

Run: `make test`
Expected: exit 0.

```bash
git add docs/manual-test-plan.md DEVELOPMENT.md
git commit -m "docs: reduce the manual test plan to a three item smoke list"
```

---

## Self-review notes

**Spec coverage.** Sections 1, 2, 3, 4, 6 in Task 3. Sections 5, 7a-d, 8 in Task 4. Section 9 in Task 5. Sections 11, 12 in Task 6. Section 10 and the two integration items stay manual per Task 9. Section 13 stays with `test-e2e.sh`. The theme global from the spec's verified findings is Task 1. The leak guard is Task 8.

**Deliberately not built.** `window.__harness`, for the reason in the Deviation section.

**Known risk.** The fixture shapes in Tasks 3 to 6 are written from `types.ts` and may not match what the components actually read. Every one of those tasks says to correct the fixture against the component rather than change the component. If a component genuinely needs changing, that is a bug and belongs in its own issue.
