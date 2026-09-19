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
