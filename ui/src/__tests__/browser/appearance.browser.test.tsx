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
import { cdp } from "vitest/browser";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

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

test("an unexpected containers response surfaces an error snackbar", async () => {
  const fake = createFakeDdClient({ containers: { totally: "wrong" } });
  const screen = await renderApp(fake);
  await expect.element(screen.getByText("Unexpected containers response format")).toBeVisible();
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
