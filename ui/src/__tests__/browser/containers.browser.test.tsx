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
