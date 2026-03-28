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

	"github.com/docker/docker/api/types/container"
)

func proxyContainer(state string) container.Summary {
	return container.Summary{
		Names: []string{"/" + proxyContainerName},
		State: state,
	}
}

func TestQueryProxyContainerStateRunning(t *testing.T) {
	cli := &fakeDockerClient{containerList: []container.Summary{proxyContainer("running")}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateRunning {
		t.Errorf("want %q, got %q", ProxyStateRunning, got)
	}
}

func TestQueryProxyContainerStatePaused(t *testing.T) {
	cli := &fakeDockerClient{containerList: []container.Summary{proxyContainer("paused")}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStatePaused {
		t.Errorf("want %q, got %q", ProxyStatePaused, got)
	}
}

func TestQueryProxyContainerStateDead(t *testing.T) {
	cli := &fakeDockerClient{containerList: []container.Summary{proxyContainer("dead")}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateFailed {
		t.Errorf("want %q, got %q", ProxyStateFailed, got)
	}
}

func TestQueryProxyContainerStateExited(t *testing.T) {
	cli := &fakeDockerClient{containerList: []container.Summary{proxyContainer("exited")}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateStopped {
		t.Errorf("want %q, got %q", ProxyStateStopped, got)
	}
}

func TestQueryProxyContainerStateMissing(t *testing.T) {
	cli := &fakeDockerClient{containerList: []container.Summary{}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateMissing {
		t.Errorf("want %q, got %q", ProxyStateMissing, got)
	}
}

func TestQueryProxyContainerStateListError(t *testing.T) {
	cli := &fakeDockerClient{containerListErr: errors.New("docker unavailable")}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateMissing {
		t.Errorf("want %q on error, got %q", ProxyStateMissing, got)
	}
}

func TestQueryProxyContainerStateIgnoresOtherContainers(t *testing.T) {
	other := container.Summary{Names: []string{"/some-other-container"}, State: "running"}
	cli := &fakeDockerClient{containerList: []container.Summary{other}}
	got := queryProxyContainerState(context.Background(), cli)
	if got != ProxyStateMissing {
		t.Errorf("want %q for unrelated container, got %q", ProxyStateMissing, got)
	}
}
