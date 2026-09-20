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

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

// Positive control for the bundle scans below: if someone reworks the throw
// in fakeDdClient.ts and rewords this marker, those scans would keep passing
// forever with half their power gone, silently. This asserts the marker is
// still present in the harness source so a rewording fails loudly here
// instead. It reads source only, and deliberately sits outside the describe
// below so that a broken build cannot take this signal down with it.
test("the harness source still contains the unexpected-GET marker string", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "__tests__", "browser", "fakeDdClient.ts"),
    "utf8",
  );
  expect(source).toContain("fake: unexpected GET");
});

describe("the built bundle", () => {
  let bundles: string[] = [];

  // execSync hands its environment to the child by default, and a vitest
  // process carries two variables that change what `pnpm build` emits:
  //
  //  - VITEST=true, which vite.config.ts keys its test-only alias of
  //    @docker/extension-api-client off, so the child build swaps in the
  //    vitest mock and pulls vitest itself into the output.
  //  - NODE_ENV=test, which stops the build resolving as production, so
  //    React's development build gets bundled instead of the minified one.
  //
  // Either one leaves these tests reading a bundle nobody ships. Both were
  // confirmed load-bearing by reverting each in turn and watching the
  // production-bundle test below fail.
  beforeAll(() => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("VITEST")) delete env[key];
    }
    env.NODE_ENV = "production";
    execSync("pnpm build", { cwd: process.cwd(), stdio: "pipe", env });

    const assets = join(process.cwd(), "build", "assets");
    bundles = readdirSync(assets)
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(assets, f), "utf8"));
  }, 120000);

  // Guards the setup above, because the harness scan is worth nothing unless
  // the bundle it reads is the one users get. Both markers survive
  // minification and each catches one way the environment can go wrong:
  //  - "Extensions can only be used in Docker Desktop" is thrown by the real
  //    client's createDockerDesktopClient(). The vitest mock is a bare
  //    vi.fn() with no such string, so its absence means the alias was live.
  //  - "Each child in a list should have a unique" is a React
  //    development-only warning, so its presence means the build did not
  //    resolve as production.
  test("is the production bundle, not a test-aliased one", () => {
    const combined = bundles.join("");

    expect(combined).toContain("Extensions can only be used in Docker Desktop");
    expect(combined).not.toContain("Each child in a list should have a unique");
  });

  // Minification renames local identifiers (like the `createFakeDdClient`
  // function name) but leaves string literals and object property accesses
  // alone. So the markers below are chosen to survive minification rather
  // than match the harness source verbatim:
  //  - "fake: unexpected GET" is a string literal from fakeDdClient.ts that
  //    only exists if that module's code made it into the bundle.
  //  - /__ddMuiV6Themes\s*=\s*\{/ matches the harness in browser/setup.ts
  //    *assigning* a fake theme object. Real app code only ever *reads*
  //    window.__ddMuiV6Themes (e.g. `window.__ddMuiV6Themes[...]`), so this
  //    pattern will not false-positive on legitimate MUI theme lookups.
  test("contains no harness code", () => {
    expect(bundles.length).toBeGreaterThan(0);

    for (const source of bundles) {
      expect(source).not.toContain("fake: unexpected GET");
      expect(source).not.toMatch(/__ddMuiV6Themes\s*=\s*\{/);
    }
  });
});
