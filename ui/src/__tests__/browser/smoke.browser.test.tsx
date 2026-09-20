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
import { render } from "vitest-browser-react";
import { DockerMuiV6ThemeProvider } from "@docker/docker-mui-theme";
import { createDockerDesktopClient } from "@docker/extension-api-client";
import { App } from "../../App";
import { createFakeDdClient } from "./fakeDdClient";
import { renderApp } from "./renderApp";

test("App mounts in a real browser without a Docker Desktop host", async () => {
  const screen = await render(
    <DockerMuiV6ThemeProvider>
      <App />
    </DockerMuiV6ThemeProvider>
  );

  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});

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

test("renderApp injects the fake into App", async () => {
  const fake = createFakeDdClient({
    containers: {
      containers: [{ containerId: "abc123", name: "seeded-container", labels: {}, addresses: [] }],
      proxyStatus: "running",
    },
  });

  const screen = await renderApp(fake);

  await expect.element(screen.getByText("seeded-container")).toBeVisible();
});

test("renderApp's mock does not leak into a test that runs after it", async () => {
  const result = createDockerDesktopClient();

  expect(result).toBeUndefined();
});
