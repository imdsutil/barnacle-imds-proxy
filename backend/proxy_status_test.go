// Copyright 2026 Matt Miller
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"context"
	"errors"
	"testing"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/docker/docker/api/types/container"
)

func proxyInspect(status string) container.InspectResponse {
	return container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{Status: status},
		},
	}
}

func TestQueryProxyContainerStateRunning(t *testing.T) {
	cli := &fakeDockerClient{inspectSequence: []container.InspectResponse{proxyInspect("running")}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateRunning {
		t.Errorf("want %q, got %q", ProxyStateRunning, got)
	}
}

func TestQueryProxyContainerStatePaused(t *testing.T) {
	cli := &fakeDockerClient{inspectSequence: []container.InspectResponse{proxyInspect("paused")}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStatePaused {
		t.Errorf("want %q, got %q", ProxyStatePaused, got)
	}
}

func TestQueryProxyContainerStateDead(t *testing.T) {
	cli := &fakeDockerClient{inspectSequence: []container.InspectResponse{proxyInspect("dead")}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateFailed {
		t.Errorf("want %q, got %q", ProxyStateFailed, got)
	}
}

func TestQueryProxyContainerStateExited(t *testing.T) {
	cli := &fakeDockerClient{inspectSequence: []container.InspectResponse{proxyInspect("exited")}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateStopped {
		t.Errorf("want %q, got %q", ProxyStateStopped, got)
	}
}

func TestQueryProxyContainerStateMissing(t *testing.T) {
	cli := &fakeDockerClient{inspectErr: cerrdefs.ErrNotFound}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateMissing {
		t.Errorf("want %q, got %q", ProxyStateMissing, got)
	}
}

func TestQueryProxyContainerStateInspectError(t *testing.T) {
	cli := &fakeDockerClient{inspectErr: errors.New("docker unavailable")}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateMissing {
		t.Errorf("want %q on error, got %q", ProxyStateMissing, got)
	}
}
