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

# Tests for ci-covers-make-test.sh, the guard that stops CI and `make test`
# drifting apart now that CI names targets instead of running `make test`.

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  CHECKER="$REPO_ROOT/scripts/ci-covers-make-test.sh"
  FIXTURE_MAKEFILE="$BATS_TEST_TMPDIR/Makefile"
  FIXTURE_CI="$BATS_TEST_TMPDIR/ci.yml"

  cat >"$FIXTURE_MAKEFILE" <<'EOF'
test: test-coverage test-scripts ## Run all tests
test-coverage: test-backend-coverage test-ui-coverage ## Coverage
test-backend-coverage: ## Backend coverage
	cd backend && go test ./...
test-ui-coverage: ## UI coverage
	cd ui && pnpm test --coverage
test-scripts: ## Script tests
	bats scripts/test-gui-debug.sh
EOF
}

# The guard's whole purpose. If the real workflow ever stops running something
# that `make test` runs, this fails and names it.
@test "the real ci.yml runs every target the real make test runs" {
  run "$CHECKER" "$REPO_ROOT/Makefile" "$REPO_ROOT/.github/workflows/ci.yml"
  [ "$status" -eq 0 ]
}

# Positive control. Without this, the test above could pass forever because the
# checker is broken rather than because CI is correct.
@test "a target missing from CI is reported by name" {
  cat >"$FIXTURE_CI" <<'EOF'
jobs:
  go:
    steps:
      - run: make test-backend-coverage
  scripts:
    steps:
      - run: make test-scripts
EOF

  run "$CHECKER" "$FIXTURE_MAKEFILE" "$FIXTURE_CI"
  [ "$status" -eq 1 ]
  [[ "$output" == *"test-ui-coverage"* ]]
}

@test "naming every leaf target across separate jobs passes" {
  cat >"$FIXTURE_CI" <<'EOF'
jobs:
  go:
    steps:
      - run: make test-backend-coverage
  ui:
    steps:
      - run: make test-ui-coverage
  scripts:
    steps:
      - run: make test-scripts
EOF

  run "$CHECKER" "$FIXTURE_MAKEFILE" "$FIXTURE_CI"
  [ "$status" -eq 0 ]
}

# An aggregate target covers its leaves, so a workflow that still runs
# `make test` directly is correct and must not be reported as drift.
@test "running the aggregate make test directly still counts as covered" {
  cat >"$FIXTURE_CI" <<'EOF'
jobs:
  test:
    steps:
      - run: make test
EOF

  run "$CHECKER" "$FIXTURE_MAKEFILE" "$FIXTURE_CI"
  [ "$status" -eq 0 ]
}

@test "several targets in one make invocation are all counted" {
  cat >"$FIXTURE_CI" <<'EOF'
jobs:
  all:
    steps:
      - run: make test-backend-coverage test-ui-coverage test-scripts
EOF

  run "$CHECKER" "$FIXTURE_MAKEFILE" "$FIXTURE_CI"
  [ "$status" -eq 0 ]
}

@test "a missing workflow file is an error, not a pass" {
  run "$CHECKER" "$FIXTURE_MAKEFILE" "$BATS_TEST_TMPDIR/does-not-exist.yml"
  [ "$status" -eq 2 ]
}

# Regression: the checker used to grep the whole workflow, so a comment
# mentioning `make test` made every target look covered and the guard could
# never fail. Only commands count.
@test "a make invocation inside a comment does not count as coverage" {
  cat >"$FIXTURE_CI" <<'YAML'
# These jobs together run everything `make test` runs.
jobs:
  go:
    steps:
      - run: make test-backend-coverage
  scripts:
    steps:
      # make test-ui-coverage used to live here
      - run: make test-scripts
YAML

  run "$CHECKER" "$FIXTURE_MAKEFILE" "$FIXTURE_CI"
  [ "$status" -eq 1 ]
  [[ "$output" == *"test-ui-coverage"* ]]
}

# Regression: a long `make a b \` + continuation line is one command, but the
# checker read only the first physical line and reported the targets on the
# continuation as missing.
@test "targets on a backslash continuation line are counted" {
  cat >"$FIXTURE_CI" <<'YAML'
jobs:
  all:
    steps:
      - run: |
          make test-backend-coverage \
               test-ui-coverage \
               test-scripts
YAML

  run "$CHECKER" "$FIXTURE_MAKEFILE" "$FIXTURE_CI"
  [ "$status" -eq 0 ]
}
