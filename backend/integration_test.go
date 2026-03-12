//go:build integration
// +build integration

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
	"testing"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/network"
)

// mockDockerClientWithEvents is a Docker client that supports event emission
type mockDockerClientWithEvents struct {
	eventsChan       chan events.Message
	errorChan        chan error
	inspectResponses map[string]container.InspectResponse
	networkConnects  []string
	pauseCalls       int
	unpauseCalls     int
}

func newMockDockerClientWithEvents() *mockDockerClientWithEvents {
	return &mockDockerClientWithEvents{
		eventsChan:       make(chan events.Message, 10),
		errorChan:        make(chan error, 1),
		inspectResponses: make(map[string]container.InspectResponse),
		networkConnects:  make([]string, 0),
	}
}

func (m *mockDockerClientWithEvents) ContainerInspect(_ context.Context, containerID string) (container.InspectResponse, error) {
	if resp, ok := m.inspectResponses[containerID]; ok {
		return resp, nil
	}
	return container.InspectResponse{}, nil
}

func (m *mockDockerClientWithEvents) ContainerList(_ context.Context, _ container.ListOptions) ([]container.Summary, error) {
	return []container.Summary{}, nil
}

func (m *mockDockerClientWithEvents) Events(_ context.Context, _ events.ListOptions) (<-chan events.Message, <-chan error) {
	return m.eventsChan, m.errorChan
}

func (m *mockDockerClientWithEvents) NetworkConnect(_ context.Context, networkID, _ string, _ *network.EndpointSettings) error {
	m.networkConnects = append(m.networkConnects, networkID)
	return nil
}

func (m *mockDockerClientWithEvents) ContainerPause(_ context.Context, _ string) error {
	m.pauseCalls++
	return nil
}

func (m *mockDockerClientWithEvents) ContainerUnpause(_ context.Context, _ string) error {
	m.unpauseCalls++
	return nil
}

func (m *mockDockerClientWithEvents) Close() error {
	close(m.eventsChan)
	close(m.errorChan)
	return nil
}

func (m *mockDockerClientWithEvents) emitEvent(event events.Message) {
	m.eventsChan <- event
}

func (m *mockDockerClientWithEvents) setInspectResponse(containerID string, resp container.InspectResponse) {
	m.inspectResponses[containerID] = resp
}

// TestContainerLifecycleIntegration verifies the complete flow:
// Docker event stream → container tracking → IP lookup → cleanup
func TestContainerLifecycleIntegration(t *testing.T) {
	// Reset state before test
	resetTracking()
	defer resetTracking()

	// Setup mock Docker client
	mockClient := newMockDockerClientWithEvents()
	originalClient := dockerClient
	dockerClient = mockClient
	defer func() { dockerClient = originalClient }()

	// Setup original shutdown channel
	originalShutdownChan := shutdownChan
	shutdownChan = make(chan struct{})
	defer func() { shutdownChan = originalShutdownChan }()

	// Define test container
	testContainerID := "abc123def456"
	testContainerName := "/test-container"
	testIP := "172.20.0.5"
	testNetworkID := "net123"
	testLabels := map[string]string{
		"imds-tools.imds-proxy.enabled": "true",
		"app":                           "test-app",
	}

	// Start monitoring Docker events in background
	go monitorDockerEvents()

	// Give monitor goroutine time to start
	time.Sleep(50 * time.Millisecond)

	// STEP 1: Emit container create event with labels
	t.Log("Step 1: Emitting container create event")

	// Setup inspect response BEFORE emitting event
	mockClient.setInspectResponse(testContainerID, container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			ID:   testContainerID,
			Name: testContainerName,
			State: &container.State{
				Running: true,
			},
		},
		Config: &container.Config{
			Labels: testLabels,
		},
		NetworkSettings: &container.NetworkSettings{
			Networks: map[string]*network.EndpointSettings{
				imdsNetworkAWSGCP: {
					NetworkID: testNetworkID,
					IPAddress: testIP,
				},
			},
		},
	})

	createEvent := events.Message{
		Type:   events.ContainerEventType,
		Action: "create",
		Actor: events.Actor{
			ID: testContainerID,
			Attributes: map[string]string{
				"imds-tools.imds-proxy.enabled": "true",
				"image":                         "test-image:latest",
			},
		},
	}
	mockClient.emitEvent(createEvent)

	// Wait for event processing
	time.Sleep(100 * time.Millisecond)

	// STEP 2: Verify container appears in tracking
	t.Log("Step 2: Verifying container appears in tracking")
	trackedContainersMutex.RLock()
	containerInfo, tracked := trackedContainers[testContainerID]
	trackedContainersMutex.RUnlock()

	if !tracked {
		t.Fatalf("Container %s not found in tracking after create event", testContainerID)
	}

	if containerInfo.ContainerID != testContainerID {
		t.Errorf("Expected container ID %s, got %s", testContainerID, containerInfo.ContainerID)
	}

	if containerInfo.Name != testContainerName {
		t.Errorf("Expected container name %s, got %s", testContainerName, containerInfo.Name)
	}

	if containerInfo.Labels["app"] != "test-app" {
		t.Errorf("Expected label app=test-app, got %s", containerInfo.Labels["app"])
	}

	// STEP 3: Verify IP indexed correctly
	t.Log("Step 3: Verifying IP indexed correctly")
	ipToContainerIDMutex.RLock()
	foundContainerID, ipFound := ipToContainerID[testNetworkID]
	ipToContainerIDMutex.RUnlock()

	if !ipFound {
		t.Errorf("IP %s not found in IP index", testNetworkID)
	}

	if foundContainerID != testContainerID {
		t.Errorf("Expected container ID %s for IP %s, got %s", testContainerID, testNetworkID, foundContainerID)
	}

	// STEP 4: Emit container destroy event
	t.Log("Step 4: Emitting container destroy event")
	destroyEvent := events.Message{
		Type:   events.ContainerEventType,
		Action: "destroy",
		Actor: events.Actor{
			ID: testContainerID,
			Attributes: map[string]string{
				"image": "test-image:latest",
			},
		},
	}
	mockClient.emitEvent(destroyEvent)

	// Wait for event processing
	time.Sleep(100 * time.Millisecond)

	// STEP 5: Verify cleanup occurs
	t.Log("Step 5: Verifying cleanup occurs")
	trackedContainersMutex.RLock()
	_, stillTracked := trackedContainers[testContainerID]
	trackedContainersMutex.RUnlock()

	if stillTracked {
		t.Errorf("Container %s still in tracking after destroy event", testContainerID)
	}

	ipToContainerIDMutex.RLock()
	_, ipStillExists := ipToContainerID[testNetworkID]
	ipToContainerIDMutex.RUnlock()

	if ipStillExists {
		t.Errorf("IP index still contains entry for network ID %s after container destroyed", testNetworkID)
	}

	// Shutdown the monitor
	close(shutdownChan)
	time.Sleep(50 * time.Millisecond)

	t.Log("Container lifecycle integration test completed successfully")
}
