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
import { ErrorBoundary } from "../../components/ErrorBoundary";

// A container payload can no longer reach the fallback, since bad elements
// are coerced before they are rendered. A child that throws on purpose is
// the only way left to exercise it, and it is what the boundary exists for:
// any future render error below it.
function Boom(): null {
  throw new Error("boom");
}

test("the error boundary shows its fallback and leaves the rest of the page standing", async () => {
  const screen = await render(
    <div>
      <h1>Barnacle IMDS Proxy</h1>
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    </div>
  );

  await expect
    .element(
      screen.getByText(
        "Something went wrong displaying this panel. Switch tabs to retry, or reopen the extension."
      )
    )
    .toBeVisible();
  await expect.element(screen.getByText("Barnacle IMDS Proxy")).toBeVisible();
});
