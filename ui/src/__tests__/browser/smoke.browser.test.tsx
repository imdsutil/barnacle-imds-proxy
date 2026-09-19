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
import { App } from "../../App";

test("App mounts in a real browser without a Docker Desktop host", async () => {
  const screen = await render(
    <DockerMuiV6ThemeProvider>
      <App />
    </DockerMuiV6ThemeProvider>
  );

  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});
