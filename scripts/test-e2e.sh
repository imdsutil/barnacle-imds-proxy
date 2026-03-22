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


CONTAINER_NAME="imds-e2e-test"
TEST_SERVER_PORT=8080
TEST_SERVER_PID=""

setup_file() {
    # Build and start the test server
    cd "$BATS_TEST_DIRNAME/../test-server"
    go build -o "$BATS_FILE_TMPDIR/test-server" .
    "$BATS_FILE_TMPDIR/test-server" -port="$TEST_SERVER_PORT" &
    TEST_SERVER_PID=$!
    echo "$TEST_SERVER_PID" > "$BATS_FILE_TMPDIR/test-server.pid"

    # Wait for it to be ready
    for i in $(seq 1 10); do
        if curl -sf "http://localhost:$TEST_SERVER_PORT/" >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    if ! curl -sf "http://localhost:$TEST_SERVER_PORT/" >/dev/null 2>&1; then
        echo "Test server failed to start on port $TEST_SERVER_PORT" >&2
        return 1
    fi

    # Start a labeled container
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker run -d --rm --name "$CONTAINER_NAME" --label imds-proxy.enabled=true alpine sleep 3600 >/dev/null

    # Wait for controller to attach networks
    for i in $(seq 1 15); do
        networks=$(docker inspect "$CONTAINER_NAME" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null || echo "")
        if echo "$networks" | grep -q 'imds_aws_gcp'; then
            return 0
        fi
        sleep 1
    done
    echo "Container was not attached to IMDS networks within 15s" >&2
    return 1
}

teardown_file() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    if [ -f "$BATS_FILE_TMPDIR/test-server.pid" ]; then
        kill "$(cat "$BATS_FILE_TMPDIR/test-server.pid")" 2>/dev/null || true
    fi
}

# --- network tests ---

@test "imds_aws_gcp network exists" {
    docker network ls --format '{{.Name}}' | grep -q '\.imds_aws_gcp'
}

@test "imds_openstack network exists" {
    docker network ls --format '{{.Name}}' | grep -q '\.imds_openstack'
}

@test "container is attached to IMDS networks" {
    networks=$(docker inspect "$CONTAINER_NAME" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}')
    echo "$networks" | grep -q 'imds_aws_gcp'
    echo "$networks" | grep -q 'imds_openstack'
}

# --- reachability tests ---

@test "IPv4 169.254.169.254 is reachable" {
    docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 http://169.254.169.254/
}

@test "IPv6 fd00:ec2::254 is reachable" {
    docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 "http://[fd00:ec2::254]/"
}

@test "IPv6 fd00:a9fe:a9fe::254 is reachable" {
    docker exec "$CONTAINER_NAME" wget -qO- --timeout=5 "http://[fd00:a9fe:a9fe::254]/"
}

# --- proxy header tests (require test server running and extension pointed at localhost:8080) ---

@test "X-Container-Id header is forwarded" {
    run docker exec "$CONTAINER_NAME" wget -qS --timeout=5 http://169.254.169.254/ -O /dev/null 2>&1
    echo "$output" | grep -qi 'X-Echo-X-Container-Id'
}

@test "X-Container-Name header is forwarded" {
    run docker exec "$CONTAINER_NAME" wget -qS --timeout=5 http://169.254.169.254/ -O /dev/null 2>&1
    echo "$output" | grep -qi 'X-Echo-X-Container-Name'
}
