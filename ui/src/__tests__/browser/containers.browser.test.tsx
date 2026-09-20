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

const container = (name: string, containerId: string, ip = "169.254.169.254") => ({
  name,
  containerId,
  labels: { "imds-proxy.enabled": "true" },
  addresses: [{ ip, connected: true }],
});

test("empty state tells the user no labeled containers are running", async () => {
  const screen = await renderApp(createFakeDdClient());
  await expect.element(screen.getByText("No labeled containers are running.")).toBeVisible();
});

test("the enabling label is shown so it can be copied", async () => {
  const screen = await renderApp(createFakeDdClient());
  await expect.element(screen.getByText("imds-proxy.enabled=true")).toBeVisible();
});

test("labeled containers are listed with their id", async () => {
  const fake = createFakeDdClient({
    containers: { containers: [container("alpha", "aaaaaaaaaaaa")] },
  });
  const screen = await renderApp(fake);
  await expect.element(screen.getByText("alpha")).toBeVisible();
  await expect.element(screen.getByText("aaaaaaaaaaaa")).toBeVisible();
});

test("containers sort by name", async () => {
  const fake = createFakeDdClient({
    containers: {
      containers: [container("zeta", "zzzzzzzzzzzz"), container("alpha", "aaaaaaaaaaaa")],
    },
  });
  const screen = await renderApp(fake);
  await expect.element(screen.getByText("alpha")).toBeVisible();
  const rows = screen.container.querySelectorAll("tbody tr[aria-expanded]");
  expect(rows[0].textContent).toContain("alpha");
});

test("a configured IMDS address is shown for each container", async () => {
  const fake = createFakeDdClient({
    containers: { containers: [container("alpha", "aaaaaaaaaaaa")] },
  });
  const screen = await renderApp(fake);
  await expect.element(screen.getByText("169.254.169.254")).toBeVisible();
});

test("the header shows the logo and the app title", async () => {
  const screen = await renderApp(createFakeDdClient());
  await expect.element(screen.getByAltText("Barnacle Logo")).toBeVisible();
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});

test("a View documentation link is visible in the top right", async () => {
  const screen = await renderApp(createFakeDdClient());
  await expect.element(screen.getByText("View documentation")).toBeVisible();
});

test("the Containers tab is selected by default", async () => {
  const screen = await renderApp(createFakeDdClient());
  const containersTab = screen.getByRole("tab", { name: "Containers" });
  const settingsTab = screen.getByRole("tab", { name: "Settings" });
  await expect.element(containersTab).toHaveAttribute("aria-selected", "true");
  await expect.element(settingsTab).toHaveAttribute("aria-selected", "false");
});

// The loading skeleton only appears while the initial /containers request is
// still in flight. The fake normally resolves synchronously, so there is no
// window to observe it. To make the window deterministic (without touching
// fakeDdClient.ts, which is off limits), this test replaces the fake's GET
// with a promise it controls, then resolves it itself once the skeleton has
// been observed.
test("a loading skeleton appears while containers are first loading, then resolves", async () => {
  const fake = createFakeDdClient();
  let resolveContainers!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    resolveContainers = resolve;
  });
  fake.extension.vm.service.get = (path: string) => {
    if (path === "/containers") return pending as Promise<unknown>;
    throw new Error(`fake: unexpected GET ${path} during loading test`);
  };

  const screen = await renderApp(fake);

  await expect.poll(() => screen.container.querySelector(".MuiSkeleton-root")).not.toBeNull();
  expect(screen.container.querySelector("table")).toBeNull();

  resolveContainers({ containers: [], proxyStatus: "running" });

  await expect.element(screen.getByText("No labeled containers are running.")).toBeVisible();
  expect(screen.container.querySelector(".MuiSkeleton-root")).toBeNull();
});

// Section 6 (sorting). Three containers whose name order and id order
// disagree, so a test that accidentally sorted by the wrong field would
// produce a visibly different (and wrong) row order rather than passing by
// coincidence.
const sortableFixture = () =>
  createFakeDdClient({
    containers: {
      containers: [
        container("zeta", "aaaaaaaaaaaa"),
        container("alpha", "zzzzzzzzzzzz"),
        container("mid", "mmmmmmmmmmmm"),
      ],
    },
  });

// Reads just the Name cell's text (the first <td>), not the whole row, since
// the row also contains the id and IP address and a whole-row textContent
// comparison would conflate all three.
function rowNames(screen: Awaited<ReturnType<typeof renderApp>>) {
  return Array.from(screen.container.querySelectorAll("tbody tr[aria-expanded]")).map(
    (row) => row.querySelector("td")?.textContent
  );
}

function isActiveAscending(headerButton: HTMLElement) {
  const icon = headerButton.querySelector(".MuiTableSortLabel-icon");
  return (
    headerButton.classList.contains("Mui-active") &&
    (icon?.classList.contains("MuiTableSortLabel-iconDirectionAsc") ?? false)
  );
}

function isActiveDescending(headerButton: HTMLElement) {
  const icon = headerButton.querySelector(".MuiTableSortLabel-icon");
  return (
    headerButton.classList.contains("Mui-active") &&
    (icon?.classList.contains("MuiTableSortLabel-iconDirectionDesc") ?? false)
  );
}

// 6.1: ContainersTable defaults to sortBy 'name' / sortOrder 'asc' before any
// header is ever clicked (see the "containers sort by name" test above), so
// clicking the already-active Name header first would immediately toggle it
// to descending rather than demonstrating a fresh ascending sort. Clicking
// Container ID first moves the active column away from Name, the same way a
// tester who had just tried section 6.3 would have, so the Name click this
// test cares about lands on a real column switch (active column: id -> name)
// rather than a same-column toggle.
test("clicking the Name header sorts ascending and shows the active sort arrow", async () => {
  const screen = await renderApp(sortableFixture());
  await expect.element(screen.getByText("alpha")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Container ID", exact: true }));
  const nameHeader = screen.getByRole("button", { name: "Name", exact: true });
  await userEvent.click(nameHeader);

  expect(rowNames(screen)).toEqual(["alpha", "mid", "zeta"]);
  expect(isActiveAscending(nameHeader.element() as HTMLElement)).toBe(true);
});

// 6.2: clicking the already-active Name header a second time reverses it.
test("clicking the Name header again sorts descending", async () => {
  const screen = await renderApp(sortableFixture());
  await expect.element(screen.getByText("alpha")).toBeVisible();

  const nameHeader = screen.getByRole("button", { name: "Name", exact: true });
  await userEvent.click(screen.getByRole("button", { name: "Container ID", exact: true }));
  await userEvent.click(nameHeader);
  await userEvent.click(nameHeader);

  expect(rowNames(screen)).toEqual(["zeta", "mid", "alpha"]);
  expect(isActiveDescending(nameHeader.element() as HTMLElement)).toBe(true);
});

// 6.3: Name is the default active column, so clicking Container ID for the
// first time is already a switch to a new column and sorts ascending by id
// without any extra setup.
test("clicking the Container ID header sorts ascending by id", async () => {
  const screen = await renderApp(sortableFixture());
  await expect.element(screen.getByText("alpha")).toBeVisible();

  const idHeader = screen.getByRole("button", { name: "Container ID", exact: true });
  await userEvent.click(idHeader);

  // ids: zeta=aaaa..., mid=mmmm..., alpha=zzzz...
  expect(rowNames(screen)).toEqual(["zeta", "mid", "alpha"]);
  expect(isActiveAscending(idHeader.element() as HTMLElement)).toBe(true);
});

// 6.4: clicking the already-active Container ID header a second time
// reverses it.
test("clicking the Container ID header again sorts descending", async () => {
  const screen = await renderApp(sortableFixture());
  await expect.element(screen.getByText("alpha")).toBeVisible();

  const idHeader = screen.getByRole("button", { name: "Container ID", exact: true });
  await userEvent.click(idHeader);
  await userEvent.click(idHeader);

  expect(rowNames(screen)).toEqual(["alpha", "mid", "zeta"]);
  expect(isActiveDescending(idHeader.element() as HTMLElement)).toBe(true);
});
