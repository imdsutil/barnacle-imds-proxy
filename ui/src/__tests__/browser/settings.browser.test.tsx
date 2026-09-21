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

async function openSettings(screen: Awaited<ReturnType<typeof renderApp>>) {
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
}

test("an existing URL is shown when the tab opens", async () => {
  const fake = createFakeDdClient({ settings: { url: "http://localhost:8080", customIPs: [] } });
  const screen = await renderApp(fake);
  await openSettings(screen);
  await expect.element(screen.getByLabelText("IMDS server URL")).toHaveValue("http://localhost:8080");
});

test("a typed URL is saved to the backend", async () => {
  const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
  const screen = await renderApp(fake);
  await openSettings(screen);

  await userEvent.fill(screen.getByLabelText("IMDS server URL"), "http://localhost:9000");
  await userEvent.click(screen.getByRole("button", { name: "Save Settings" }));

  await expect.poll(() => fake.savedSettings.length).toBe(1);
  expect((fake.savedSettings[0] as { url: string }).url).toBe("http://localhost:9000");
});

test("an invalid URL is rejected rather than saved", async () => {
  const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
  const screen = await renderApp(fake);
  await openSettings(screen);

  // "not-a-url" fails the component's own regex (/^https?:\/\/[^/\\]/) because
  // it does not start with http:// or https:// at all, so this input is
  // guaranteed to be rejected. Note the same regex is a loose prefix check:
  // it wrongly ACCEPTS things like "http://local host" or "http:// " as long
  // as they start with "http://" or "https://" followed by any character
  // other than "/" or "\".
  await userEvent.fill(screen.getByLabelText("IMDS server URL"), "not-a-url");
  await userEvent.click(screen.getByRole("button", { name: "Save Settings" }));

  await expect
    .element(screen.getByText("Enter a valid URL (e.g. http://localhost:8080)"))
    .toBeVisible();
  expect(fake.savedSettings).toHaveLength(0);
});

// Issue #77: SettingsForm.tsx:115-121 checks whether the form is dirty
// BEFORE calling getSettings(), but loadSettings() (line 77) never re-checks
// dirtiness after the await, so a poll response that resolves while the
// form is clean, but after the user has since started typing, unconditionally
// overwrites their keystrokes. Reproduced against the real extension: typing
// a URL, pausing about a second, then clicking Save lost the input entirely.
//
// To reproduce deterministically we let the 5s poll fire while the field is
// still clean (so its dirty check passes), then hold its /settings response
// in flight while the user types, then let it resolve.
test("a settings poll does not overwrite text being typed", async () => {
  const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
  const screen = await renderApp(fake);
  await openSettings(screen);

  const field = screen.getByLabelText("IMDS server URL");
  await expect.element(field).toHaveValue("");

  let resolvePoll!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    resolvePoll = resolve;
  });
  let pollStarted = false;
  const originalGet = fake.extension.vm.service.get.bind(fake.extension.vm.service);
  fake.extension.vm.service.get = (path: string) => {
    if (path === "/settings") {
      pollStarted = true;
      return pending as Promise<unknown>;
    }
    return originalGet(path);
  };

  // Wait for the 5s poll to fire and start its (now controlled) request.
  await expect.poll(() => pollStarted, { timeout: 8000 }).toBe(true);

  // Type while that request is still in flight.
  await userEvent.fill(field, "http://localhost:9000");

  // The in-flight response now resolves with the old (empty) settings. Give
  // the resulting state update a moment to land before asserting, since the
  // field can transiently still show the typed value on the first render
  // pass even when the poll goes on to overwrite it.
  resolvePoll({ url: "", customIPs: [] });
  await new Promise((r) => setTimeout(r, 500));

  await expect.element(field).toHaveValue("http://localhost:9000");
}, 15000);

// Issue #77, third defect: the poll used to compare customIPs unsorted while
// the Save button compared them sorted, so removing an IP and adding it back
// left the two disagreeing. The Save button called the form clean and stayed
// disabled while the poll called it dirty and stopped refreshing forever,
// leaving the tab stuck on stale data with no way to force a reload. Both
// now use one definition of dirty, in which IP order is not a change.
test("reordering the IP list does not freeze the settings poll", async () => {
  const fake = createFakeDdClient({
    settings: { url: "http://saved.example:8080", customIPs: ["10.0.0.1", "10.0.0.2"] },
  });
  const screen = await renderApp(fake);
  await openSettings(screen);

  const field = screen.getByLabelText("IMDS server URL");
  await expect.element(field).toHaveValue("http://saved.example:8080");

  // Remove the first IP and add it back, so the set is unchanged but the
  // order is not.
  const removeFirst = screen.container.querySelector(
    '[data-testid="CancelIcon"]',
  ) as HTMLElement;
  await userEvent.click(removeFirst);
  await userEvent.fill(screen.getByRole("textbox", { name: "IP address" }), "10.0.0.1");
  await userEvent.click(screen.getByRole("button", { name: /add ip address/i }));

  // Same set in a different order is not an unsaved change.
  await expect
    .element(screen.getByRole("button", { name: /save settings/i }))
    .toBeDisabled();

  // The poll must still be running: an external change has to land.
  fake.setSettings({ url: "http://changed.example:9000", customIPs: ["10.0.0.1", "10.0.0.2"] });
  await expect.element(field, { timeout: 9000 }).toHaveValue("http://changed.example:9000");
}, 20000);
