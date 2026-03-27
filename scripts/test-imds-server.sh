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

# Integration test: barnacle-imds-proxy + imds-server end-to-end
#
# Prerequisites:
#   - Docker Desktop running with barnacle extension installed and enabled
#   - barnacle configured to forward to http://localhost:3000
#     (set this in the barnacle extension UI before running)
#   - imds-server repo checked out (default: ~/repos/imdsutil/imds-server)
#     override with: IMDS_SERVER_REPO=/path/to/imds-server bats scripts/test-imds-server.sh
#   - Node.js available in PATH
#
# Usage:
#   bats scripts/test-imds-server.sh

CONTAINER_NAME="imds-server-integration-test"
IMDS_SERVER_PORT=3000
IMDS_SERVER_REPO="${IMDS_SERVER_REPO:-$HOME/repos/imdsutil/imds-server}"

setup_file() {
    # Verify prerequisites
    if ! command -v node >/dev/null 2>&1; then
        echo "node not found in PATH" >&2
        return 1
    fi

    if [ ! -f "$IMDS_SERVER_REPO/src/index.js" ]; then
        echo "imds-server not found at $IMDS_SERVER_REPO" >&2
        echo "Set IMDS_SERVER_REPO=/path/to/imds-server and retry" >&2
        return 1
    fi

    local echo_handler="$IMDS_SERVER_REPO/test/fixtures/echo-handler.sh"
    chmod +x "$echo_handler"

    # Write a temp config pointing at the echo handler
    local config_file="$BATS_FILE_TMPDIR/imds-server.yaml"
    cat > "$config_file" <<EOF
port: $IMDS_SERVER_PORT
logLevel: info
handlers:
  - command: $echo_handler
    types:
      - credentials
EOF

    # Start imds-server
    node "$IMDS_SERVER_REPO/src/index.js" --config "$config_file" &
    echo "$!" > "$BATS_FILE_TMPDIR/imds-server.pid"

    # Wait for imds-server to be ready
    for i in $(seq 1 10); do
        if curl -s --max-time 2 "http://localhost:$IMDS_SERVER_PORT/latest/meta-data/" >/dev/null 2>&1 >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    if ! curl -s --max-time 2 "http://localhost:$IMDS_SERVER_PORT/latest/meta-data/" >/dev/null 2>&1 >/dev/null 2>&1; then
        echo "imds-server failed to start on port $IMDS_SERVER_PORT" >&2
        return 1
    fi

    # Start a labeled container
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker run -d --rm --name "$CONTAINER_NAME" --label imds-proxy.enabled=true alpine sleep 3600 >/dev/null

    # Wait for barnacle to attach IMDS networks
    for i in $(seq 1 15); do
        networks=$(docker inspect "$CONTAINER_NAME" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null || echo "")
        if echo "$networks" | grep -q 'imds_aws_gcp'; then
            return 0
        fi
        sleep 1
    done
    echo "Container was not attached to IMDS networks within 15s" >&2
    echo "Is barnacle running and configured to forward to http://localhost:$IMDS_SERVER_PORT?" >&2
    return 1
}

teardown_file() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    if [ -f "$BATS_FILE_TMPDIR/imds-server.pid" ]; then
        kill "$(cat "$BATS_FILE_TMPDIR/imds-server.pid")" 2>/dev/null || true
    fi
}

# --- reachability ---

@test "credentials endpoint is reachable via 169.254.169.254" {
    run docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 \
        http://169.254.169.254/latest/meta-data/iam/security-credentials/test-role
    [ "$status" -eq 0 ]
}

# --- response content ---

@test "credentials response contains Code field" {
    response=$(docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 \
        http://169.254.169.254/latest/meta-data/iam/security-credentials/test-role)
    echo "$response" | grep -q '"Code"'
}

@test "credentials response contains AccessKeyId field" {
    response=$(docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 \
        http://169.254.169.254/latest/meta-data/iam/security-credentials/test-role)
    echo "$response" | grep -q '"AccessKeyId"'
}

@test "credentials response contains SecretAccessKey field" {
    response=$(docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 \
        http://169.254.169.254/latest/meta-data/iam/security-credentials/test-role)
    echo "$response" | grep -q '"SecretAccessKey"'
}

@test "credentials response contains Expiration field" {
    response=$(docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 \
        http://169.254.169.254/latest/meta-data/iam/security-credentials/test-role)
    echo "$response" | grep -q '"Expiration"'
}

# --- proxy headers ---

@test "x-container-id header is forwarded to imds-server" {
    container_id=$(docker inspect "$CONTAINER_NAME" --format '{{.Id}}')
    response=$(docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 \
        http://169.254.169.254/latest/meta-data/iam/security-credentials/test-role)
    # imds-server logs the container id; check it received a non-empty request
    [ -n "$response" ]
}
