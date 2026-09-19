/**
 * Copyright 2026 Matt Miller
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { defineConfig as defineVitestConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const isTest = process.env.VITEST === "true";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({ fastRefresh: !isTest })],
  base: "./",
  build: {
    outDir: "build",
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  resolve: {
    alias: isTest
      ? {
          "@docker/extension-api-client": new URL(
            "./src/__tests__/__mocks__/extension-api-client.ts",
            import.meta.url
          ).pathname,
        }
      : {},
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/__tests__/setup.ts"],
          include: ["src/__tests__/**/*.test.{ts,tsx}"],
          exclude: ["src/__tests__/browser/**"],
          alias: {
            "./logo.svg": new URL(
              "./src/__tests__/__mocks__/fileMock.ts",
              import.meta.url
            ).pathname,
          },
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          globals: true,
          setupFiles: ["./src/__tests__/browser/setup.ts"],
          include: ["src/__tests__/browser/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage",
      exclude: [
        "src/main.tsx",
        "src/__tests__/**",
        "src/**/__mocks__/**",
        "**/*.d.ts",
        "vite.config.ts",
        "build/**",
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
