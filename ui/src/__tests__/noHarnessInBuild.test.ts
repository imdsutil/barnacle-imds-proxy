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
import { expect, test } from "vitest";

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
test("the production bundle contains no harness code", () => {
  execSync("pnpm build", { cwd: process.cwd(), stdio: "pipe" });

  const assets = join(process.cwd(), "build", "assets");
  const bundles = readdirSync(assets).filter((f) => f.endsWith(".js"));
  expect(bundles.length).toBeGreaterThan(0);

  for (const file of bundles) {
    const source = readFileSync(join(assets, file), "utf8");
    expect(source).not.toContain("fake: unexpected GET");
    expect(source).not.toMatch(/__ddMuiV6Themes\s*=\s*\{/);
  }
}, 120000);
