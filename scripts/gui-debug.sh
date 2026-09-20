#!/usr/bin/env bash
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

# Drive the real Docker Desktop UI for debugging.
#
# Docker Desktop's window is a native Wayland client, which no X tool can see.
# This runs it inside a nested X server instead, so it can be screenshotted and
# clicked. Only Docker Desktop moves to X11; the desktop session is untouched.
#
# This is a debugging aid, not a test harness. Nothing depends on it for a
# pass/fail signal, so it fails loudly rather than skipping when the environment
# is not set up. See docs/design/ui-test-harness.md.

if [[ -z "${GUI_DEBUG_LIB:-}" ]]; then
  set -euo pipefail
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION="${GUI_DEBUG_EXTENSION:-barnacle-imds-proxy}"
NESTED_DISPLAY="${GUI_DEBUG_DISPLAY:-:2}"
NESTED_SCREEN="${GUI_DEBUG_SCREEN:-1600x1000}"
# Docker Desktop is software-rendered in Xephyr, so it paints slowly on start.
STARTUP_TIMEOUT="${GUI_DEBUG_TIMEOUT:-240}"
MIN_WINDOW_AREA=10000
SERVICE="docker-desktop.service"
DROPIN_DIR="${HOME}/.config/systemd/user/docker-desktop.service.d"
DROPIN="${DROPIN_DIR}/99-gui-debug.conf"

die() {
  echo "gui-debug: $*" >&2
  exit 1
}

require_deps() {
  local missing=()
  command -v Xephyr >/dev/null 2>&1 || missing+=("Xephyr (apt: xserver-xephyr)")
  command -v xdotool >/dev/null 2>&1 || missing+=("xdotool (apt: xdotool)")
  command -v import >/dev/null 2>&1 || missing+=("import (apt: imagemagick)")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "gui-debug: missing dependencies:" >&2
    printf '  %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# to_screen_coords WIN_X WIN_Y REL_X REL_Y
# Translates coordinates relative to a window into coordinates on the nested
# display. Screenshots are per-window, so the coordinates read off an image are
# window-relative and would land in the wrong place if used directly.
to_screen_coords() {
  local win_x="$1" win_y="$2" rel_x="$3" rel_y="$4"
  local value
  for value in "$win_x" "$win_y" "$rel_x" "$rel_y"; do
    [[ "$value" =~ ^-?[0-9]+$ ]] || { echo "gui-debug: coordinates must be numeric, got '$value'" >&2; return 1; }
  done
  echo "$((win_x + rel_x)) $((win_y + rel_y))"
}

# pick_window_id TARGET  (reads "id<TAB>area<TAB>title" lines on stdin)
# TARGET is extension, dashboard, or any.
#
# Docker Desktop maps several 10x10 placeholder windows alongside the real one,
# so selection is by area rather than by order. "extension" prefers the webview
# by title and falls back to the main window, which is what exists before an
# extension tab has been opened.
pick_window_id() {
  local target="$1" id area title
  local best_id="" best_area=0 named_id="" named_area=0

  while IFS=$'\t' read -r id area title; do
    [[ -n "$id" ]] || continue
    [[ "$area" =~ ^[0-9]+$ ]] || continue
    [[ "$area" -ge $MIN_WINDOW_AREA ]] || continue

    if [[ "$area" -gt "$best_area" ]]; then
      best_area="$area"
      best_id="$id"
    fi
    if [[ "$target" == "extension" && "$title" == *"extension"* && "$area" -gt "$named_area" ]]; then
      named_area="$area"
      named_id="$id"
    fi
  done

  case "$target" in
    extension|dashboard|any) ;;
    *) echo "gui-debug: unknown window target '$target' (want extension, dashboard or any)" >&2; return 1 ;;
  esac

  if [[ -n "$named_id" ]]; then
    echo "$named_id"
    return 0
  fi
  if [[ -n "$best_id" ]]; then
    echo "$best_id"
    return 0
  fi

  echo "gui-debug: no usable '$target' window on $NESTED_DISPLAY; is Docker Desktop running there? try: $0 status" >&2
  return 1
}

# is_repo_vite CMDLINE
# True only for a Vite belonging to this checkout. The machine may well have
# another dev server on the same port, and killing that would be rude.
is_repo_vite() {
  local cmdline="$1"
  [[ "$cmdline" == *"$REPO_ROOT/ui/"* && "$cmdline" == *vite* ]]
}

stop_dev_server() {
  local pid cmdline stopped=0
  for pid in /proc/[0-9]*; do
    pid="${pid#/proc/}"
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    [[ -n "$cmdline" ]] || continue
    if is_repo_vite "$cmdline"; then
      kill "$pid" 2>/dev/null && stopped=$((stopped + 1))
    fi
  done
  [[ $stopped -gt 0 ]] && echo "stopped $stopped Vite dev server process(es)"
  return 0
}

reset_extension_dev_mode() {
  command -v docker >/dev/null 2>&1 || return 0
  if docker extension dev reset "$EXTENSION" >/dev/null 2>&1; then
    echo "reset extension dev mode (ui-source and debug)"
  fi
  return 0
}

display_is_up() {
  DISPLAY="$NESTED_DISPLAY" xdotool getdisplaygeometry >/dev/null 2>&1
}

require_display() {
  display_is_up || die "nested display $NESTED_DISPLAY is not running; run '$0 start' first"
}

list_windows() {
  local id name
  while read -r id; do
    [[ -n "$id" ]] || continue
    name="$(DISPLAY="$NESTED_DISPLAY" xdotool getwindowname "$id" 2>/dev/null || true)"
    if [[ -n "$name" ]]; then
      local geom w h
      geom="$(DISPLAY="$NESTED_DISPLAY" xdotool getwindowgeometry --shell "$id" 2>/dev/null || true)"
      w="$(sed -n 's/^WIDTH=//p' <<<"$geom")"
      h="$(sed -n 's/^HEIGHT=//p' <<<"$geom")"
      [[ "$w" =~ ^[0-9]+$ && "$h" =~ ^[0-9]+$ ]] || { w=0; h=0; }
      printf '%s\t%s\t%s\n' "$id" "$((w * h))" "$name"
    fi
  done < <(DISPLAY="$NESTED_DISPLAY" xdotool search --name "." 2>/dev/null || true)
  # Unnamed windows are normal, so a trailing miss must not look like failure.
  return 0
}

window_geometry() {
  DISPLAY="$NESTED_DISPLAY" xdotool getwindowgeometry --shell "$1"
}

resolve_window() {
  # Collected first rather than piped: pick_window_id returns on the first match,
  # and under `set -o pipefail` the resulting closed pipe would fail the lookup
  # even though the window was found.
  local windows
  windows="$(list_windows)" || true
  pick_window_id "$1" <<<"$windows"
}

cmd_start() {
  require_deps || exit 1

  if display_is_up; then
    echo "nested display $NESTED_DISPLAY already running"
  else
    echo "starting Xephyr on $NESTED_DISPLAY ($NESTED_SCREEN)"
    Xephyr "$NESTED_DISPLAY" -screen "$NESTED_SCREEN" -ac -title "Docker Desktop (gui-debug)" >/dev/null 2>&1 &
    disown
    local waited=0
    until display_is_up; do
      sleep 1
      waited=$((waited + 1))
      [[ $waited -lt 15 ]] || die "Xephyr did not come up on $NESTED_DISPLAY"
    done
  fi

  mkdir -p "$DROPIN_DIR"
  cat > "$DROPIN" <<EOF
# Written by scripts/gui-debug.sh. Remove with: $0 stop
[Service]
Environment=DISPLAY=$NESTED_DISPLAY
Environment=XDG_SESSION_TYPE=x11
UnsetEnvironment=WAYLAND_DISPLAY
EOF
  systemctl --user daemon-reload
  echo "restarting Docker Desktop into $NESTED_DISPLAY (this takes a moment)"
  systemctl --user restart "$SERVICE"

  local waited=0
  until resolve_window any >/dev/null 2>&1; do
    sleep 2
    waited=$((waited + 2))
    [[ $waited -lt $STARTUP_TIMEOUT ]] || die "Docker Desktop did not appear on $NESTED_DISPLAY after ${waited}s; check '$0 status' and raise GUI_DEBUG_TIMEOUT if it is just slow"
  done
  echo "ready. Docker Desktop is on $NESTED_DISPLAY"
  cmd_status
}

cmd_stop() {
  if [[ -f "$DROPIN" ]]; then
    rm -f "$DROPIN"
    rmdir "$DROPIN_DIR" 2>/dev/null || true
    systemctl --user daemon-reload
    echo "removed drop-in, restarting Docker Desktop on the normal display"
    systemctl --user restart "$SERVICE" || true
  else
    echo "no drop-in found; Docker Desktop was already on the normal display"
  fi

  local xephyr_pid
  xephyr_pid="$(pgrep -x Xephyr 2>/dev/null | head -1 || true)"
  if [[ -n "$xephyr_pid" ]]; then
    kill "$xephyr_pid" 2>/dev/null || true
    echo "stopped Xephyr on $NESTED_DISPLAY"
  fi

  reset_extension_dev_mode
  stop_dev_server
}

cmd_status() {
  if display_is_up; then
    echo "nested display $NESTED_DISPLAY: up"
  else
    echo "nested display $NESTED_DISPLAY: down"
    return 0
  fi
  [[ -f "$DROPIN" ]] && echo "drop-in: installed" || echo "drop-in: absent"
  echo "windows:"
  list_windows | while IFS=$'\t' read -r id area title; do
    printf '  %-10s %-8s %s\n' "$id" "${area}px" "$title"
  done
}

cmd_window() {
  require_display
  local target="${1:-any}" id
  id="$(resolve_window "$target")" || exit 1
  echo "id: $id"
  window_geometry "$id"
}

cmd_shot() {
  require_display
  local target="extension" out=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --full) target="root" ;;
      --target) shift; target="${1:-}" ;;
      *) out="$1" ;;
    esac
    shift
  done
  out="${out:-gui-debug.png}"

  if [[ "$target" == "root" ]]; then
    DISPLAY="$NESTED_DISPLAY" import -window root "$out"
  else
    local id
    id="$(resolve_window "$target")" || exit 1
    DISPLAY="$NESTED_DISPLAY" import -window "$id" "$out"
  fi
  echo "$out"
}

cmd_click() {
  local target="extension"
  if [[ "${1:-}" == "--target" ]]; then
    shift; target="${1:-}"; shift
  fi
  [[ $# -ge 2 ]] || die "Usage: $0 click [--target NAME] X Y   (coordinates are relative to the window)"
  require_display

  local id geom win_x win_y coords
  id="$(resolve_window "$target")" || exit 1
  geom="$(window_geometry "$id")"
  win_x="$(sed -n 's/^X=//p' <<<"$geom")"
  win_y="$(sed -n 's/^Y=//p' <<<"$geom")"
  coords="$(to_screen_coords "$win_x" "$win_y" "$1" "$2")" || exit 1

  # shellcheck disable=SC2086
  DISPLAY="$NESTED_DISPLAY" xdotool mousemove --sync $coords click 1
  echo "clicked $coords on $NESTED_DISPLAY (window $id, relative $1 $2)"
}

cmd_type() {
  [[ $# -ge 1 ]] || die "Usage: $0 type TEXT"
  require_display
  local id
  id="$(resolve_window extension)" || exit 1
  # windowfocus, not windowactivate: there is no window manager inside Xephyr,
  # so _NET_ACTIVE_WINDOW is unsupported and activate fails.
  DISPLAY="$NESTED_DISPLAY" xdotool windowfocus --sync "$id" type -- "$*"
}

cmd_key() {
  [[ $# -ge 1 ]] || die "Usage: $0 key KEY [KEY...]   (e.g. Tab, Return, ctrl+a)"
  require_display
  local id
  id="$(resolve_window extension)" || exit 1
  DISPLAY="$NESTED_DISPLAY" xdotool windowfocus --sync "$id" key -- "$@"
}

usage() {
  cat <<EOF
Usage: $0 COMMAND [ARGS]

Runs Docker Desktop inside a nested X server so its UI can be screenshotted and
clicked. Only Docker Desktop is affected; your desktop session stays as it is.

  start                      Start the nested display and move Docker Desktop into it
  stop                       Tear down: nested display, extension dev mode, dev server
  status                     Show the nested display, drop-in and window list
  window [TARGET]            Print a window's id and geometry
  shot [--full] [FILE]       Screenshot the extension window (or the whole display)
  click [--target N] X Y     Click at coordinates relative to the window
  type TEXT                  Type into the extension window
  key KEY [KEY...]           Send keys to the extension window (Tab, Return, ctrl+a)

TARGET is extension (default), dashboard or any.

Environment:
  GUI_DEBUG_DISPLAY  nested display to use (default :2)
  GUI_DEBUG_SCREEN   nested screen size (default 1600x1000)
  GUI_DEBUG_TIMEOUT  seconds to wait for Docker Desktop on start (default 240)

Xephyr is software-rendered, so Docker Desktop will feel slow. Run '$0 stop'
when you are done.
EOF
}

main() {
  local cmd="${1:-}"
  [[ -n "$cmd" ]] || { usage; exit 1; }
  shift

  case "$cmd" in
    start)  cmd_start "$@" ;;
    stop)   cmd_stop "$@" ;;
    status) cmd_status "$@" ;;
    window) cmd_window "$@" ;;
    shot)   cmd_shot "$@" ;;
    click)  cmd_click "$@" ;;
    type)   cmd_type "$@" ;;
    key)    cmd_key "$@" ;;
    -h|--help|help) usage ;;
    *) echo "gui-debug: unknown command '$cmd'" >&2; usage >&2; exit 1 ;;
  esac
}

if [[ -z "${GUI_DEBUG_LIB:-}" ]]; then
  main "$@"
fi
