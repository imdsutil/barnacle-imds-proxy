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

export interface FakeState {
  settings: unknown;
  containers: unknown;
  proxyStatus: string;
  failGet: Record<string, number | undefined>;
}

export interface FakeDdClient {
  extension: {
    vm: { service: { get(path: string): Promise<unknown>; post(path: string, body: unknown): Promise<unknown> } };
  };
  docker: { cli: { exec(cmd: string, args: string[]): Promise<{ stdout: string }> } };
  host: { openExternal(url: string): void };
  setContainers(value: unknown): void;
  setSettings(value: unknown): void;
  setProxyStatus(value: string): void;
  failNext(path: string, status: number): void;
  savedSettings: unknown[];
  openedUrls: string[];
  execCalls: string[];
}

export function createFakeDdClient(initial: Partial<FakeState> = {}): FakeDdClient {
  const state: FakeState = {
    settings: initial.settings ?? { url: "", customIPs: [] },
    containers: initial.containers ?? { containers: [], proxyStatus: "running" },
    proxyStatus: initial.proxyStatus ?? "running",
    failGet: { ...(initial.failGet ?? {}) },
  };
  const savedSettings: unknown[] = [];
  const openedUrls: string[] = [];
  const execCalls: string[] = [];

  const maybeFail = (path: string) => {
    const status = state.failGet[path];
    if (status !== undefined) {
      delete state.failGet[path];
      throw new Error(`fake: ${path} failed with ${status}`);
    }
  };

  return {
    extension: {
      vm: {
        service: {
          async get(path: string) {
            maybeFail(path);
            if (path === "/settings") return state.settings;
            if (path === "/containers") {
              const value = state.containers as Record<string, unknown>;
              if (value && typeof value === "object" && "containers" in value) {
                return { ...value, proxyStatus: state.proxyStatus };
              }
              return value;
            }
            if (path === "/compose-project-name") return { projectName: "", configFiles: "" };
            throw new Error(`fake: unexpected GET ${path}`);
          },
          async post(path: string, body: unknown) {
            maybeFail(path);
            if (path === "/settings") {
              savedSettings.push(body);
              state.settings = body;
              return { ok: true };
            }
            throw new Error(`fake: unexpected POST ${path}`);
          },
        },
      },
    },
    docker: {
      cli: {
        async exec(cmd: string, args: string[]) {
          execCalls.push([cmd, ...args].join(" "));
          return { stdout: "" };
        },
      },
    },
    host: {
      openExternal(url: string) {
        openedUrls.push(url);
      },
    },
    setContainers(value: unknown) {
      state.containers = value;
    },
    setSettings(value: unknown) {
      state.settings = value;
    },
    setProxyStatus(value: string) {
      state.proxyStatus = value;
    },
    failNext(path: string, status: number) {
      state.failGet[path] = status;
    },
    savedSettings,
    openedUrls,
    execCalls,
  };
}
