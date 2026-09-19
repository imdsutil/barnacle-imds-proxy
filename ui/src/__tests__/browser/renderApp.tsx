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

import { vi } from "vitest";
import { render } from "vitest-browser-react";
import { DockerMuiV6ThemeProvider } from "@docker/docker-mui-theme";
import { createDockerDesktopClient } from "@docker/extension-api-client";
import { App } from "../../App";
import type { FakeDdClient } from "./fakeDdClient";

export async function renderApp(fake: FakeDdClient) {
  vi.mocked(createDockerDesktopClient).mockReturnValue(fake as never);
  return await render(
    <DockerMuiV6ThemeProvider>
      <App />
    </DockerMuiV6ThemeProvider>
  );
}
