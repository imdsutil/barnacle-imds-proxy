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
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

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
  await expect.element(screen.getByText("No labeled containers are running.")).toBeVisible();
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

// Skipped: reproduces issue #64's sibling defect at App.tsx:134. A malformed
// /containers response bypasses the unreachable state machine and fires a
// non-dismissable error snackbar on every poll tick. Remove .skip when fixed.
test.skip("a malformed containers response does not loop an undismissable error", async () => {
  const fake = createFakeDdClient({ containers: { totally: "wrong" } });
  const screen = await renderApp(fake);
  await expect.element(screen.getByRole("alert")).toBeVisible();
});

// Skipped: issue #65. Both type guards are shape only and there is no error
// boundary, so one malformed element blanks the panel. Remove .skip when fixed.
test.skip("a malformed container element does not blank the panel", async () => {
  const fake = createFakeDdClient({ containers: { containers: [{}] }, proxyStatus: "running" });
  const screen = await renderApp(fake);
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});
