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

# Assert the CI workflow runs every target that `make test` runs.
#
# CI used to run the single command `make test`, which made drift impossible.
# It now runs targets in parallel jobs, so the workflow names them one by one.
# Without this check, adding a target to `make test` gives you the target
# locally and silently skips it in CI, and nothing fails to tell you.
#
# Usage: ci-covers-make-test.sh [MAKEFILE] [CI_FILE]

set -euo pipefail

MAKEFILE="${1:-Makefile}"
CI_FILE="${2:-.github/workflows/ci.yml}"

for f in "$MAKEFILE" "$CI_FILE"; do
  if [[ ! -f "$f" ]]; then
    echo "not found: $f" >&2
    exit 2
  fi
done

# The prerequisites of a target, with the trailing `## help text` stripped.
# Prints nothing when the target has no prerequisites, which makes it a leaf.
prereqs_of() {
  awk -v target="$1" '
    index($0, target ":") == 1 {
      line = $0
      sub(/^[^:]*:/, "", line)
      sub(/##.*/, "", line)
      print line
      exit
    }
  ' "$MAKEFILE"
}

# Expand a target to the leaf targets it ultimately runs.
leaves_of() {
  local target="$1" prereqs child
  prereqs="$(prereqs_of "$target")"

  if [[ -z "${prereqs// /}" ]]; then
    echo "$target"
    return
  fi

  for child in $prereqs; do
    leaves_of "$child"
  done
}

# Every target named in a `make ...` command in the workflow.
#
# Comment lines are dropped first. Both YAML comments and shell comments
# inside a run block start with #, and neither is a command. Without this the
# guard counted a comment mentioning `make test` as full coverage, which made
# it incapable of ever failing.
ci_targets() {
  # Join backslash continuations first, so `make a \` plus its continuation
  # lines is read as the single command it is rather than just its first line.
  sed -e ':a' -e '/\\$/{N;s/\\\n[[:space:]]*/ /;ba' -e '}' "$CI_FILE" |
    grep -vE '^[[:space:]]*#' |
    grep -oE '\bmake +[a-z0-9][a-z0-9 -]*' |
    sed -E 's/^make +//' |
    tr ' ' '\n' |
    grep -v '^$' || true
}

covered="$(
  for target in $(ci_targets); do
    leaves_of "$target"
  done | sort -u
)"

required="$(leaves_of test | sort -u)"

missing=""
while read -r target; do
  [[ -z "$target" ]] && continue
  if ! grep -qxF "$target" <<<"$covered"; then
    missing+="  $target"$'\n'
  fi
done <<<"$required"

if [[ -n "$missing" ]]; then
  echo "CI does not run every target that 'make test' runs." >&2
  echo "Missing from $CI_FILE:" >&2
  printf '%s' "$missing" >&2
  echo "Add them to a job, or remove them from 'make test'." >&2
  exit 1
fi

echo "OK: $CI_FILE runs all $(wc -l <<<"$required") targets that 'make test' runs"
