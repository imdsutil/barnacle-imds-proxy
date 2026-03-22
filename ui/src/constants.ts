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

/**
 * How often to poll for container updates (in milliseconds)
 */
export const CONTAINER_POLL_INTERVAL_MS = 1000;

/**
 * How long to disable the save button after saving to prevent rapid re-submission (in milliseconds)
 */
export const SAVE_DEBOUNCE_MS = 1000;

/**
 * How many characters of container ID to display in the table (full ID shown on hover)
 */
export const CONTAINER_ID_DISPLAY_LENGTH = 12;

/**
 * How long to show snackbar notifications before auto-hiding (in milliseconds)
 */
export const SNACKBAR_AUTO_HIDE_DURATION_MS = 6000;

/**
 * GitHub repository URL for documentation
 */
export const GITHUB_REPO_URL = 'https://github.com/imdsutil/barnacle-imds-proxy';

/**
 * Container label that enables IMDS proxying
 */
export const IMDS_PROXY_ENABLED_LABEL = 'imds-proxy.enabled=true';
