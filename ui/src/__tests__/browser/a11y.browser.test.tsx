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
import axe from "axe-core";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

const container = (name: string, containerId: string) => ({
  name,
  containerId,
  labels: { "imds-proxy.enabled": "true" },
  addresses: [{ ip: "169.254.169.254", connected: true }],
});

const withRows = () =>
  createFakeDdClient({
    containers: {
      containers: [container("alpha", "aaaaaaaaaaaa"), container("beta", "bbbbbbbbbbbb")],
      proxyStatus: "running",
    },
  });

// Calling .focus() directly proves an element CAN take focus, not that a
// keyboard user can Tab to it: it succeeds even on a natively focusable
// element that someone has removed from the Tab order with tabIndex={-1}.
// This drives real Tab key presses instead, bounded so a target that is
// never reached fails clearly rather than hanging.
async function tabUntilFocused(target: HTMLElement, maxTabs: number) {
  for (let i = 0; i < maxTabs && document.activeElement !== target; i++) {
    await userEvent.tab();
  }
}

type Screen = Awaited<ReturnType<typeof renderApp>>;

// Reaches and activates the Settings tab the same way a keyboard-only user
// would: real Tab to the tablist (Containers is the only real Tab stop),
// ArrowRight to move the roving-tabindex focus to Settings, then Enter to
// activate it.
async function openSettingsByKeyboard(screen: Screen) {
  const containersTab = screen.getByRole("tab", { name: /containers/i }).query() as HTMLElement;
  await tabUntilFocused(containersTab, 5);
  await userEvent.keyboard("{ArrowRight}");
  await userEvent.keyboard("{Enter}");
}

// 1.5, 1.6: the header is reachable and the docs link takes visible focus.
// Confirmed by walking real Tab presses from a fresh render (throwaway
// debug walk, since removed): the documentation link is the very first Tab
// stop.
test(
  "the documentation link is reachable by keyboard",
  async () => {
    const screen = await renderApp(createFakeDdClient());
    const link = screen.getByRole("link", { name: /documentation/i });
    const el = link.query() as HTMLElement;
    await tabUntilFocused(el, 5);
    await expect.element(link).toHaveFocus();
  },
  8000
);

// 1.7: both tabs are reachable by keyboard. MUI's Tabs component uses a
// roving tabindex, the WAI-ARIA APG "tabs" pattern: only the selected tab
// (Containers, initially) is ever a real Tab stop, and the other tab is
// reached with the arrow keys once the tablist has focus, not with another
// Tab press. Confirmed with a throwaway debug walk (since removed): Tab
// alone from a fresh render never lands on the Settings tab while
// Containers is selected. That is correct, standard tab-widget behaviour,
// not a bug, so this reaches Settings with Tab then ArrowRight rather than
// asserting Tab reaches it directly.
test(
  "both tabs are reachable by keyboard",
  async () => {
    const screen = await renderApp(createFakeDdClient());
    const containersTab = screen.getByRole("tab", { name: /containers/i }).query() as HTMLElement;
    await tabUntilFocused(containersTab, 5);
    expect(document.activeElement).toBe(containersTab);

    const settingsTab = screen.getByRole("tab", { name: /settings/i }).query() as HTMLElement;
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(settingsTab);
  },
  8000
);

// 1.8: Enter and Space on a focused tab switch to it.
test.each(["{Enter}", " "])("pressing %s on the settings tab switches to it", async (key) => {
  const screen = await renderApp(createFakeDdClient());
  const el = screen.getByRole("tab", { name: /settings/i }).query() as HTMLElement;
  el.focus();
  await userEvent.keyboard(key);
  await expect.element(screen.getByLabelText(/imds server url/i)).toBeVisible();
});

// 4.9: a row takes visible focus when tabbed to. Reached with real Tab
// presses from a fresh render (the documentation link, the Containers tab,
// the label's copy button, and the two column sort labels all come before
// it, confirmed by a throwaway debug walk, since removed), not with
// .focus(), which would succeed even if the row's tabIndex were removed.
test(
  "a container row is reachable by keyboard and shows focus",
  async () => {
    const screen = await renderApp(withRows());
    await expect.element(screen.getByText("alpha")).toBeVisible();

    const row = screen.container.querySelector("tbody tr[aria-expanded]") as HTMLElement;
    await tabUntilFocused(row, 12);
    expect(document.activeElement).toBe(row);
  },
  8000
);

// 4.10 and 4.11: Enter and Space both toggle the row.
//
// Both rows always render with an aria-expanded attribute (its value
// toggles true/false; the row is never removed), so counting matched
// elements can never change. Polling the attribute's own value is the
// correct way to observe the toggle.
test.each(["{Enter}", " "])("pressing %s on a focused row toggles it", async (key) => {
  const screen = await renderApp(withRows());
  await expect.element(screen.getByText("alpha")).toBeVisible();

  const row = screen.container.querySelector("tbody tr[aria-expanded]") as HTMLElement;
  row.focus();
  const before = row.getAttribute("aria-expanded");
  await userEvent.keyboard(key);
  await expect.poll(() => row.getAttribute("aria-expanded")).not.toBe(before);
});

// 4.13, 4.14, 4.15: the per-row controls are focusable and Enter-activated.
// Reached to the row with real Tab presses, then one further real Tab per
// control, asserting focus lands on each in DOM order (copy name, copy id,
// the connected-address chip, then expand/collapse), rather than jumping to
// each with .focus(), which cannot detect a control removed from the Tab
// order.
test(
  "every interactive control in a row is reachable by keyboard",
  async () => {
    const screen = await renderApp(withRows());
    await expect.element(screen.getByText("alpha")).toBeVisible();

    const row = screen.container.querySelector("tbody tr[aria-expanded]") as HTMLElement;
    await tabUntilFocused(row, 12);
    expect(document.activeElement).toBe(row);

    // Expected controls and their accessible names are fixed here, from the
    // "alpha" fixture above, rather than read off the row under test: if a
    // control (e.g. the copy-id IconButton) were deleted from
    // ContainersTable, this list would still have 4 entries and the
    // toHaveLength/name checks below would fail instead of silently passing.
    const expectedControlNames = [
      "Copy container name alpha",
      "Copy container id aaaaaaaaaaaa",
      "Connected",
      "Expand labels",
    ];
    const controls = row.querySelectorAll('button, [tabindex]:not([tabindex="-1"])');
    expect(controls.length).toBe(expectedControlNames.length);
    controls.forEach((control, i) => {
      const name = control.getAttribute("aria-label") ?? control.textContent?.trim();
      expect(name).toBe(expectedControlNames[i]);
    });
    for (const control of controls) {
      await userEvent.tab();
      expect(document.activeElement).toBe(control);
    }
  },
  8000
);

// 4.16 and 4.17: tab order moves between rows without trapping focus.
test("tabbing moves forward out of a row and shift-tab moves back", async () => {
  const screen = await renderApp(withRows());
  await expect.element(screen.getByText("alpha")).toBeVisible();

  const first = screen.container.querySelector("tbody tr[aria-expanded]") as HTMLElement;
  first.focus();
  const start = document.activeElement;

  await userEvent.tab();
  expect(document.activeElement).not.toBe(start);

  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(start);
});

// 2.3: tab through the empty containers state. Focus should not get
// trapped, and the label code element and the documentation link should
// stay reachable. A trap would mean repeated Tab presses keep landing on
// the same one element instead of moving on, so this checks that Tab
// visits more than one distinct element as well as checking the two
// specific targets, rather than just checking the targets in isolation
// (which a trap elsewhere on the page would not catch).
test(
  "tabbing through the empty containers state does not trap focus",
  async () => {
    const screen = await renderApp(createFakeDdClient());
    await expect.element(screen.getByText(/no labeled containers/i)).toBeVisible();

    const visited = new Set<Element | null>();
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      visited.add(document.activeElement);
    }

    expect(visited.size).toBeGreaterThan(1);

    const link = screen.getByRole("link", { name: /documentation/i }).query();
    const labelCode = screen.getByText("imds-proxy.enabled=true").query();
    expect(visited.has(link)).toBe(true);
    expect(visited.has(labelCode)).toBe(true);
  },
  8000
);

// 9.10: the Settings tab activates from the keyboard ("Tab to Settings tab,
// press Enter"). openSettingsByKeyboard does the Tab/ArrowRight/Enter
// sequence; the assertion here is on the ArrowRight step landing on the
// real tab element, not just on .focus() succeeding.
test(
  "the settings tab activates by keyboard",
  async () => {
    const screen = await renderApp(createFakeDdClient());
    const containersTab = screen.getByRole("tab", { name: /containers/i }).query() as HTMLElement;
    await tabUntilFocused(containersTab, 5);
    const settingsTab = screen.getByRole("tab", { name: /settings/i }).query() as HTMLElement;
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(settingsTab);
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByLabelText(/imds server url/i)).toBeVisible();
  },
  8000
);

// 9.11, 9.12, 9.13: edit and save with the keyboard alone. Reached with
// real Tab presses throughout: to the URL field (the first Tab stop once
// Settings is open), and, after typing, to the Save button (which is
// disabled and so out of the Tab order until the field's value differs
// from what was last saved, confirmed by a throwaway debug walk before
// writing this test, since removed).
test(
  "settings can be edited and saved without a mouse",
  async () => {
    const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
    const screen = await renderApp(fake);
    await openSettingsByKeyboard(screen);

    const fieldEl = screen.getByLabelText(/imds server url/i).query() as HTMLElement;
    await tabUntilFocused(fieldEl, 5);
    expect(document.activeElement).toBe(fieldEl);
    await userEvent.keyboard("http://localhost:9000");

    const saveEl = screen.getByRole("button", { name: /save/i }).query() as HTMLElement;
    await tabUntilFocused(saveEl, 6);
    expect(document.activeElement).toBe(saveEl);
    await userEvent.keyboard("{Enter}");

    await expect.poll(() => fake.savedSettings.length).toBe(1);
  },
  8000
);

// 9.14: an invalid keyboard submit reports the error and keeps focus near the field.
test(
  "an invalid keyboard submit reports an error",
  async () => {
    const fake = createFakeDdClient({ settings: { url: "", customIPs: [] } });
    const screen = await renderApp(fake);
    await openSettingsByKeyboard(screen);

    const fieldEl = screen.getByLabelText(/imds server url/i).query() as HTMLElement;
    await tabUntilFocused(fieldEl, 5);
    await userEvent.keyboard("not a url");

    const saveEl = screen.getByRole("button", { name: /save/i }).query() as HTMLElement;
    await tabUntilFocused(saveEl, 6);
    expect(document.activeElement).toBe(saveEl);
    await userEvent.keyboard("{Enter}");

    expect(fake.savedSettings).toHaveLength(0);
    await expect.element(screen.getByText(/enter a valid url/i)).toBeVisible();
  },
  8000
);

async function auditFor(node: HTMLElement) {
  const results = await axe.run(node, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`);
}

// Pre-existing bug: ContainersTable.tsx puts aria-expanded on the <tr>
// element (role "row"), which does not support that attribute per the
// ARIA spec. axe flags it as
// "aria-conditional-attr: ARIA attributes must be used as specified for
// the element's role (2 nodes)", one node per rendered container row.
// Not a test bug: confirmed by running the audit against real rendered
// rows and reading the violation's target selectors, both pointing at the
// two <tr aria-expanded="..."> rows. Fixing it means changing
// ContainersTable.tsx, which is out of scope for this task.
//
// Whoever fixes this will also need to update the "tbody tr[aria-expanded]"
// selector used in this file (the 4.9, 4.10/4.11, 4.13-4.15 and 4.16/4.17
// tests above) and in containers.browser.test.tsx:55, since both rely on
// aria-expanded staying on the <tr>.
//
// Note: the WCAG A/AA tags include color-contrast, and this harness seeds
// window.__ddMuiV6Themes with empty theme objects, so MUI falls back to its
// own default palette here rather than Docker Desktop's real one. A "no
// violations" result from this audit is only a claim about MUI's defaults,
// not the colors a user actually sees.
test.skip("the containers tab has no WCAG A or AA violations", async () => {
  const screen = await renderApp(withRows());
  await expect.element(screen.getByText("alpha")).toBeVisible();
  expect(await auditFor(screen.container as HTMLElement)).toEqual([]);
});

// Pre-existing bug: SettingsForm.tsx's "add IP address" IconButton
// (onClick={handleAddIP}, wrapping only an AddIcon) has no aria-label and
// no visible text, so it has no accessible name. axe flags it as
// "button-name: Buttons must have discernible text (1 nodes)", pointing at
// that one button. Fixing it means changing SettingsForm.tsx, which is out
// of scope for this task.
//
// Note: the WCAG A/AA tags include color-contrast, and this harness seeds
// window.__ddMuiV6Themes with empty theme objects, so MUI falls back to its
// own default palette here rather than Docker Desktop's real one. A "no
// violations" result from this audit is only a claim about MUI's defaults,
// not the colors a user actually sees.
test.skip("the settings tab has no WCAG A or AA violations", async () => {
  const screen = await renderApp(createFakeDdClient());
  await userEvent.click(screen.getByRole("tab", { name: /settings/i }));
  await expect.element(screen.getByLabelText(/imds server url/i)).toBeVisible();
  expect(await auditFor(screen.container as HTMLElement)).toEqual([]);
});
