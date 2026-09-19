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

import { afterEach, expect, test } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

const seededContainer = {
  name: "seeded-container",
  containerId: "aaaaaaaaaaaa",
  labels: { "imds-proxy.enabled": "true" },
  addresses: [{ ip: "169.254.169.254", connected: true }],
};

async function openSettings(screen: Awaited<ReturnType<typeof renderApp>>) {
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
}

// navigator.clipboard.writeText genuinely fails in this environment: headless
// chromium under the playwright provider rejects it with NotAllowedError
// ("Document is not focused", then "Write permission denied" once a click
// gives the document focus), even after granting the CDP
// "clipboardReadWrite"/"clipboardSanitizedWrite" permissions via
// Browser.grantPermissions. That was confirmed empirically before writing
// these tests; it is not an assumption. So there is no way to observe a real
// clipboard success in this browser mode, only a real failure. The existing
// jsdom suite (src/__tests__/app.test.tsx) already stubs
// navigator.clipboard for the same reason. These tests do the same, locally
// to this file, restoring the original afterwards so it cannot leak into
// other browser test files.
//
// navigator.clipboard is a getter on Navigator.prototype, not an own
// property, so there is nothing to save and reassign: stubbing it shadows
// the getter with an own property, and deleting that own property re-exposes
// the prototype getter, restoring the native implementation. Confirmed this
// with a throwaway probe test (since removed): after stub then delete,
// navigator.clipboard.writeText was the native function again.
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

function restoreClipboard() {
  delete (navigator as { clipboard?: unknown }).clipboard;
}

// @vitest/browser 4.1.11 has no `page.emulateMedia`: `BrowserPage` (in
// @vitest/browser/context.d.ts) exposes only viewport/screenshot/mark/
// extend/elementLocator/frameLocator. The documented way to drive
// `prefers-color-scheme` under the playwright provider is the raw CDP
// session it exposes via `cdp()`, sending the same
// `Emulation.setEmulatedMedia` command Playwright's own `emulateMedia`
// wraps. Confirmed this reaches the test iframe: after calling it,
// `window.matchMedia("(prefers-color-scheme: <scheme>)").matches` in the
// test frame flips accordingly (asserted below).
//
// The override applies to the whole browser page, not just one test, so it
// is reset after every test in this file. "no-preference" was dropped from
// the media-queries spec and Chromium does not honour it as a real value,
// but sending it here does clear the override back to the browser's actual
// default (verified: it resolves to matching "light", not neither), so it
// is a safe reset that avoids leaking into tests that run afterwards (in
// this file or others).
async function setColorScheme(scheme: "light" | "dark" | "no-preference") {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: scheme }],
  });
}

afterEach(async () => {
  await setColorScheme("no-preference");
  // Safety net: each clipboard test already restores in its own
  // try/finally, but this guards against the stub leaking into other
  // browser test files if a test throws before reaching its try block.
  restoreClipboard();
});

test(
  "a backend outage surfaces the unreachable banner",
  async () => {
    // App.tsx requires UNREACHABLE_THRESHOLD (2) consecutive /containers
    // failures, one per CONTAINER_POLL_INTERVAL_MS (1000ms) tick, before it
    // shows the unreachable Alert. failNext only fails one request and is
    // consumed by it, so it is re-armed right after the initial mount for
    // the first poll tick to fail too.
    const fake = createFakeDdClient();
    fake.failNext("/containers", 500);
    const screen = await renderApp(fake);
    fake.failNext("/containers", 500);
    await expect
      .element(screen.getByText("Extension backend not responding - list may be outdated."), {
        timeout: 4000,
      })
      .toBeVisible();
  },
  8000
);

// Not a manual test plan section 11 item: this covers a separate
// showSnackbar branch (App.tsx line ~135, an unexpected /containers response
// shape) that had no test anywhere in the suite.
test("a malformed containers response drives App's own error-snackbar branch", async () => {
  const fake = createFakeDdClient({ containers: { totally: "wrong" } });
  const screen = await renderApp(fake);
  await expect.element(screen.getByText("Unexpected containers response format")).toBeVisible();
});

// Section 11.1 and 11.2: saving valid settings shows a green snackbar, and
// it auto-dismisses after SNACKBAR_SUCCESS_DURATION_MS (3000ms). App.tsx
// sets autoHideDuration to that value only when snackbarSeverity is
// "success" (App.tsx ~line 400), so this also pins down the "green"/success
// half of the 11.4 contrast.
test(
  "saving valid settings shows a success snackbar that auto-dismisses",
  async () => {
    const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
    const screen = await renderApp(fake);
    await openSettings(screen);

    await userEvent.fill(screen.getByLabelText("IMDS server URL"), "http://localhost:9000");
    await userEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    const alert = screen.getByText("Settings saved");
    await expect.element(alert).toBeVisible();
    expect(screen.container.querySelector(".MuiAlert-standardSuccess")).not.toBeNull();

    // 11.2: real ~3s wait for the auto-dismiss timer. There is no condition
    // to poll for here other than time passing, so this is a real wait
    // rather than expect.poll, with a generous timeout past the 3000ms
    // configured duration.
    await expect.element(alert, { timeout: 5000 }).not.toBeInTheDocument();
  },
  8000
);

// Section 11.3 and 11.4: copying succeeds with a green auto-dismissing
// snackbar, copying fails with a red snackbar that does NOT auto-dismiss.
// The contrast is the actual behaviour under test (autoHideDuration is null
// for error severity, App.tsx ~line 400), so both are asserted here.
test(
  "copying to the clipboard shows a success snackbar that auto-dismisses",
  async () => {
    stubClipboard(() => Promise.resolve());
    try {
      const fake = createFakeDdClient({ containers: { containers: [seededContainer] } });
      const screen = await renderApp(fake);

      await userEvent.click(
        screen.getByRole("button", { name: `Copy container name ${seededContainer.name}` })
      );

      const alert = screen.getByText("Copied container name to clipboard");
      await expect.element(alert).toBeVisible();
      expect(screen.container.querySelector(".MuiAlert-standardSuccess")).not.toBeNull();
      await expect.element(alert, { timeout: 5000 }).not.toBeInTheDocument();
    } finally {
      restoreClipboard();
    }
  },
  8000
);

test("a clipboard failure shows an error snackbar that does not auto-dismiss", async () => {
  stubClipboard(() => Promise.reject(new Error("denied")));
  try {
    const fake = createFakeDdClient({ containers: { containers: [seededContainer] } });
    const screen = await renderApp(fake);

    await userEvent.click(
      screen.getByRole("button", { name: `Copy container name ${seededContainer.name}` })
    );

    const alert = screen.getByText("Failed to copy to clipboard");
    await expect.element(alert).toBeVisible();
    expect(screen.container.querySelector(".MuiAlert-standardError")).not.toBeNull();

    // Real wait past the success duration to prove it is still there,
    // contrasting with the success case above which is gone by this point.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await expect.element(alert).toBeVisible();
  } finally {
    restoreClipboard();
  }
}, 8000);

// Section 11.5: clicking the error snackbar's close (X) button dismisses it
// manually. Reuses the clipboard failure to produce a non-auto-dismissing
// error snackbar, since section 11.4 already established it will not go
// away on its own.
test("clicking the close button dismisses an error snackbar", async () => {
  stubClipboard(() => Promise.reject(new Error("denied")));
  try {
    const fake = createFakeDdClient({ containers: { containers: [seededContainer] } });
    const screen = await renderApp(fake);

    await userEvent.click(
      screen.getByRole("button", { name: `Copy container name ${seededContainer.name}` })
    );
    const alert = screen.getByText("Failed to copy to clipboard");
    await expect.element(alert).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await expect.element(alert).not.toBeInTheDocument();
  } finally {
    restoreClipboard();
  }
});

// Section 11.6: tabbing to the close button and pressing Enter dismisses it
// the same way a click does. The copy button that triggers the failure
// keeps focus after the click, and tabbing forward from there reaches the
// snackbar's close button (confirmed by walking document.activeElement
// through each tab before writing this test). The loop below drives real
// Tab key presses rather than focusing the button directly, and stops as
// soon as focus lands there instead of hard-coding how many tabs that
// takes, so it does not become a brittle, confusingly-failing assertion
// if an unrelated change adds or removes a focusable element earlier in
// the row. The bound (8) and the toHaveFocus() assertion after the loop
// mean it still fails, clearly, if the button becomes unreachable by Tab.
test("tabbing to the close button and pressing Enter dismisses an error snackbar", async () => {
  stubClipboard(() => Promise.reject(new Error("denied")));
  try {
    const fake = createFakeDdClient({ containers: { containers: [seededContainer] } });
    const screen = await renderApp(fake);

    await userEvent.click(
      screen.getByRole("button", { name: `Copy container name ${seededContainer.name}` })
    );
    const alert = screen.getByText("Failed to copy to clipboard");
    await expect.element(alert).toBeVisible();

    const closeButton = screen.getByRole("button", { name: "Close" });
    for (let i = 0; i < 8 && closeButton.element() !== document.activeElement; i++) {
      await userEvent.tab();
    }
    await expect.element(closeButton).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await expect.element(alert).not.toBeInTheDocument();
  } finally {
    restoreClipboard();
  }
});

test("the app renders under a dark colour scheme", async () => {
  await setColorScheme("dark");
  const screen = await renderApp(createFakeDdClient());
  expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});

test("the app renders under a light colour scheme", async () => {
  await setColorScheme("light");
  const screen = await renderApp(createFakeDdClient());
  expect(window.matchMedia("(prefers-color-scheme: light)").matches).toBe(true);
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});
