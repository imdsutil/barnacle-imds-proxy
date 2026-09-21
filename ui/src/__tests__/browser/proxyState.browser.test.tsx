// Copyright 2026 Matt Miller

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

// [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// <reference types="@vitest/browser/matchers" />

import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";
import { GITHUB_REPO_URL } from "../../constants";

test.each(["stopped", "paused", "failed", "missing"])(
  "proxy status %s produces a visible alert",
  async (status) => {
    const fake = createFakeDdClient({ proxyStatus: status });
    const screen = await renderApp(fake);
    await expect.element(screen.getByRole("alert")).toBeVisible();
  }
);

test("a running proxy shows no alert", async () => {
  const fake = createFakeDdClient({ proxyStatus: "running" });
  const screen = await renderApp(fake);
  await expect.element(screen.getByText("No labeled containers found.")).toBeVisible();
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

// Section 8 (backend unreachable). failAlways keeps every /containers GET
// failing, unlike failNext which only fails once, so the app can accumulate
// UNREACHABLE_THRESHOLD (2) consecutive failures and then hold that state
// across further poll ticks instead of recovering on the very next one.
async function reachUnreachable() {
  const fake = createFakeDdClient();
  fake.failAlways("/containers", 500);
  const screen = await renderApp(fake);
  await expect
    .element(screen.getByText("Extension backend not responding - list may be outdated."), {
      timeout: 5000,
    })
    .toBeVisible();
  return { fake, screen };
}

// 8.2: the Settings tab shows its own warning alert (separate wording from
// the Containers tab banner) with a Get help button, once the backend is
// unreachable.
test(
  "the Settings tab shows a backend-unreachable warning with a Get help button",
  async () => {
    const { screen } = await reachUnreachable();
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));

    await expect
      .element(
        screen.getByText(
          "Extension backend not responding. Your last saved settings are shown below, but changes cannot be saved."
        )
      )
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Get help" })).toBeVisible();
  },
  8000
);

// An edit the user cannot save must survive. The settings poll runs every
// 5 seconds regardless of proxyUnreachable, so this waits longer than one
// interval and asserts the typed value is still there. Reverting it would
// discard input the user never agreed to lose, which is the same defect as
// the poll overwriting keystrokes mid-type. See #77.
test(
  "editing the URL field while the backend is unreachable keeps what you typed",
  async () => {
    const fake = createFakeDdClient({ settings: { url: "http://saved.example:8080", customIPs: [] } });
    fake.failAlways("/containers", 500);
    const screen = await renderApp(fake);
    await expect
      .element(screen.getByText("Extension backend not responding - list may be outdated."), {
        timeout: 5000,
      })
      .toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));

    const field = screen.getByLabelText(/imds server url/i);
    await expect.element(field).toHaveValue("http://saved.example:8080");
    await userEvent.click(field);
    await userEvent.keyboard("XYZ");
    await expect.element(field).toHaveValue("http://saved.example:8080XYZ");

    // Longer than the 5000ms poll interval, so a poll has certainly run.
    await new Promise((r) => setTimeout(r, 6500));
    await expect.element(field).toHaveValue("http://saved.example:8080XYZ");
  },
  10000
);

// 8.6: the help dialog's recovery steps are listed in severity order (least
// drastic first): navigate away and back, then disable/re-enable the
// extension, then restart Docker Desktop, then reboot. Reads the actual
// list item order from the DOM rather than asserting each text is present
// somewhere, so a reorder in App.tsx would fail this.
test(
  "the help dialog lists recovery steps in severity order",
  async () => {
    const { screen } = await reachUnreachable();
    await userEvent.click(screen.getByRole("button", { name: "Get help" }));

    await expect.element(screen.getByText("Extension backend not responding", { exact: true })).toBeVisible();
    // MUI's Dialog renders through a portal, outside screen.container, so
    // the list items are queried from the document instead.
    const steps = Array.from(document.querySelectorAll(".MuiListItemText-primary")).map(
      (el) => el.textContent
    );
    expect(steps).toEqual([
      "1. Navigate away and return",
      "2. Disable and re-enable the extension",
      "3. Restart Docker Desktop",
      "4. Reboot",
    ]);
  },
  8000
);

// 8.8: clicking "view the troubleshooting guide" inside the dialog opens the
// GitHub troubleshooting URL via host.openExternal.
test(
  'clicking "view the troubleshooting guide" opens the GitHub troubleshooting URL',
  async () => {
    const { fake, screen } = await reachUnreachable();
    await userEvent.click(screen.getByRole("button", { name: "Get help" }));

    await userEvent.click(screen.getByRole("link", { name: "view the troubleshooting guide" }));

    expect(fake.openedUrls).toContain(`${GITHUB_REPO_URL}#troubleshooting`);
  },
  8000
);

// 8.10: once the backend recovers, the unreachable banner disappears and
// stays gone rather than flickering back on a subsequent poll tick.
test(
  "the unreachable banner disappears cleanly once the backend recovers",
  async () => {
    const { fake, screen } = await reachUnreachable();

    fake.clearFailAlways("/containers");

    const banner = screen.getByText("Extension backend not responding - list may be outdated.");
    await expect.element(banner, { timeout: 5000 }).not.toBeInTheDocument();

    // Real wait past another couple of poll ticks to catch a flicker back.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  },
  10000
);

// Issue #75. A malformed /containers response used to never increment
// consecutiveFailuresRef, so the app never entered the same
// backend-unreachable state a real failed request reaches after
// UNREACHABLE_THRESHOLD ticks; it just fired a fresh error snackbar
// (autoHideDuration null) on every poll tick instead. This asserts the
// unreachable banner, not just "an alert exists".
test("a malformed containers response drives the app into the unreachable state", async () => {
  const fake = createFakeDdClient({ containers: { totally: "wrong" } });
  const screen = await renderApp(fake);
  await expect
    .element(screen.getByText("Extension backend not responding - list may be outdated."), {
      timeout: 5000,
    })
    .toBeVisible();
});

// Issue #74. The guards were shape only and there was no error boundary, so
// one malformed element blanked the panel (cleanContainerName in
// containerUtils.ts:25 threw "Cannot read properties of undefined (reading
// 'startsWith')" and React unmounted the tree). Bad elements are now coerced
// with per-field fallbacks instead.
test("a malformed container element does not blank the panel", async () => {
  const fake = createFakeDdClient({ containers: { containers: [{}] }, proxyStatus: "running" });
  const screen = await renderApp(fake);
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});

// Also issue #74: a bad element must not cost the user the good ones. The
// mixed fixture pins down that both valid containers still render, that the
// bad row is identifiable by its accessible name rather than by its red tint
// alone, and that it is not expandable (expandable rows carry aria-expanded,
// so counting them catches a malformed row that became clickable).
test("a malformed container element renders as a warning row beside the good ones", async () => {
  const fake = createFakeDdClient({
    containers: {
      containers: [
        {
          name: "alpha",
          containerId: "aaaaaaaaaaaa",
          labels: { "imds-proxy.enabled": "true" },
          addresses: [{ ip: "169.254.169.254", connected: true }],
        },
        { containerId: 42 },
        {
          name: "beta",
          containerId: "bbbbbbbbbbbb",
          labels: { "imds-proxy.enabled": "true" },
          addresses: [{ ip: "169.254.169.254", connected: true }],
        },
      ],
    },
    proxyStatus: "running",
  });
  const screen = await renderApp(fake);

  await expect.element(screen.getByText("alpha")).toBeVisible();
  await expect.element(screen.getByText("beta")).toBeVisible();
  await expect
    .element(screen.getByRole("img", { name: "Invalid data for this container" }))
    .toBeVisible();
  expect(screen.container.querySelectorAll("tbody tr:has(button[aria-expanded])").length).toBe(2);
});
