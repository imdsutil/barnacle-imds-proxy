#!/usr/bin/env bats
# Copyright 2026 Matt Miller
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Tests for scripts/gui-debug.sh.
#
# These cover the pure logic and the failure messages. They do not start Xephyr
# or Docker Desktop, so they run anywhere, including in CI without a display.

SCRIPT="${BATS_TEST_DIRNAME}/gui-debug.sh"

setup() {
  GUI_DEBUG_LIB=1 source "$SCRIPT"
}

# --- coordinate translation ---

@test "to_screen_coords offsets window-relative coords by window position" {
  run to_screen_coords 16 10 100 50
  [ "$status" -eq 0 ]
  [ "$output" = "116 60" ]
}

@test "to_screen_coords handles a window at the origin" {
  run to_screen_coords 0 0 42 7
  [ "$status" -eq 0 ]
  [ "$output" = "42 7" ]
}

@test "to_screen_coords rejects non-numeric input rather than emitting garbage" {
  run to_screen_coords 16 10 abc 50
  [ "$status" -ne 0 ]
  [[ "$output" == *"numeric"* ]]
}

# --- window selection ---

@test "pick_window_id prefers the extension webview over the dashboard" {
  run bash -c "printf '%b\n' '4194305\t100\tdashboard' '2097155\t564000\textension - Docker Desktop' | { GUI_DEBUG_LIB=1 source '$SCRIPT'; pick_window_id extension; }"
  [ "$status" -eq 0 ]
  [ "$output" = "2097155" ]
}

@test "pick_window_id fails loudly when the requested window is absent" {
  run bash -c "printf '%b\n' '2097152\t100\tChromium clipboard' | { GUI_DEBUG_LIB=1 source '$SCRIPT'; pick_window_id extension; }"
  [ "$status" -ne 0 ]
  [[ "$output" == *"extension"* ]]
}

@test "pick_window_id ignores the Chromium clipboard helper window" {
  run bash -c "printf '%b\n' '2097152\t100\tChromium clipboard' '2097155\t564000\textension - Docker Desktop' | { GUI_DEBUG_LIB=1 source '$SCRIPT'; pick_window_id any; }"
  [ "$status" -eq 0 ]
  [ "$output" = "2097155" ]
}

# --- dependency checking ---

@test "require_deps names the apt package when a dependency is missing" {
  run bash -c "GUI_DEBUG_LIB=1 source '$SCRIPT'; PATH=/nonexistent; require_deps"
  [ "$status" -ne 0 ]
  [[ "$output" == *"xserver-xephyr"* ]] || [[ "$output" == *"xdotool"* ]] || [[ "$output" == *"imagemagick"* ]]
}

# --- argument validation ---

@test "no command prints usage and exits non-zero" {
  run "$SCRIPT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Usage"* ]]
}

@test "unknown command is rejected by name" {
  run "$SCRIPT" frobnicate
  [ "$status" -ne 0 ]
  [[ "$output" == *"frobnicate"* ]]
}

@test "click without coordinates is rejected" {
  run "$SCRIPT" click
  [ "$status" -ne 0 ]
  [[ "$output" == *"Usage"* ]] || [[ "$output" == *"coordinate"* ]]
}

@test "type without text is rejected" {
  run "$SCRIPT" type
  [ "$status" -ne 0 ]
}

# --- failing loudly when the environment is not set up ---

@test "commands needing the nested display fail with a clear message when it is down" {
  run env GUI_DEBUG_DISPLAY=:77 "$SCRIPT" window
  [ "$status" -ne 0 ]
  [[ "$output" == *":77"* ]]
  [[ "$output" == *"start"* ]]
}

# --- resolve_window under the shell options the script actually runs with ---
#
# pick_window_id returns as soon as it finds a match, which leaves the producer
# with a closed pipe. Under `set -euo pipefail` that made the whole lookup fail
# even though the window was found, and the caller exited silently.

@test "resolve_window succeeds under set -euo pipefail when the producer exits non-zero" {
  run bash -c "set -euo pipefail; GUI_DEBUG_LIB=1 source '$SCRIPT'; list_windows() { printf '%b\n' '4194305\t100\tdashboard' '2097155\t564000\textension - Docker Desktop'; return 1; }; resolve_window extension"
  [ "$status" -eq 0 ]
  [ "$output" = "2097155" ]
}

@test "list_windows returns success even when the last window has no name" {
  run bash -c "set -euo pipefail; GUI_DEBUG_LIB=1 source '$SCRIPT'; xdotool() { case \"\$*\" in *search*) echo 111; echo 222 ;; *getwindowname*222*) echo '' ;; *getwindowname*111*) echo 'dashboard' ;; esac; }; export -f xdotool; list_windows >/dev/null; echo \"rc=\$?\""
  [ "$status" -eq 0 ]
}

# --- window selection against what Docker Desktop actually exposes ---
#
# Only one window is real. "dashboard" and "Chromium clipboard" are 10x10
# placeholders, so picking the first non-clipboard entry returned a window that
# cannot be screenshotted or clicked.

@test "any picks the largest window, not the first non-clipboard one" {
  run bash -c "printf '%b\n' '2097152\t100\tChromium clipboard' '4194305\t100\tdashboard' '2097155\t564000\textension - Docker Desktop' | { GUI_DEBUG_LIB=1 source '$SCRIPT'; pick_window_id any; }"
  [ "$status" -eq 0 ]
  [ "$output" = "2097155" ]
}

@test "dashboard resolves to the real window rather than the 10x10 placeholder" {
  run bash -c "printf '%b\n' '4194305\t100\tdashboard' '2097155\t564000\tDocker Desktop' | { GUI_DEBUG_LIB=1 source '$SCRIPT'; pick_window_id dashboard; }"
  [ "$status" -eq 0 ]
  [ "$output" = "2097155" ]
}

@test "extension falls back to the largest window before the extension tab is opened" {
  run bash -c "printf '%b\n' '4194305\t100\tdashboard' '2097155\t564000\tDocker Desktop' | { GUI_DEBUG_LIB=1 source '$SCRIPT'; pick_window_id extension; }"
  [ "$status" -eq 0 ]
  [ "$output" = "2097155" ]
}

@test "no window big enough to interact with is reported as a failure" {
  run bash -c "printf '%b\n' '2097152\t100\tChromium clipboard' '4194305\t100\tdashboard' | { GUI_DEBUG_LIB=1 source '$SCRIPT'; pick_window_id any; }"
  [ "$status" -ne 0 ]
}

# --- teardown scope ---

@test "is_repo_vite matches this repo's dev server only" {
  run bash -c "GUI_DEBUG_LIB=1 source '$SCRIPT'; is_repo_vite \"node \$REPO_ROOT/ui/node_modules/.pnpm/vite@7/node_modules/vite/bin/vite.js\""
  [ "$status" -eq 0 ]
}

@test "is_repo_vite does not match an unrelated vite elsewhere on the machine" {
  run bash -c "GUI_DEBUG_LIB=1 source '$SCRIPT'; is_repo_vite 'node /home/someone/other-project/node_modules/vite/bin/vite.js'"
  [ "$status" -ne 0 ]
}
