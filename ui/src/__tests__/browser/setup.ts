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

import { afterEach, beforeEach, vi } from "vitest";
import { createDockerDesktopClient } from "@docker/extension-api-client";

declare global {
  interface Window {
    __ddMuiV6Themes?: Record<string, object>;
    __ddMuiV5Themes?: Record<string, object>;
  }
}

beforeEach(() => {
  window.__ddMuiV6Themes = { light: {}, dark: {} };
  window.__ddMuiV5Themes = { light: {}, dark: {} };
});

afterEach(() => {
  vi.mocked(createDockerDesktopClient).mockReset();
});
