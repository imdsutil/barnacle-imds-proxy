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

// The project's tsconfig uses classic "Node" module resolution, which does
// not follow the "exports" map in vitest's package.json. vitest-browser-react's
// types import from the "vitest/browser" subpath, which only resolves through
// that map, so without this shim TypeScript silently loses the LocatorSelectors
// members (e.g. getByText) on the browser render result. Re-declare the
// subpath here so the ambient module name resolves directly.
declare module "vitest/browser" {
  export * from "@vitest/browser/context";
}
