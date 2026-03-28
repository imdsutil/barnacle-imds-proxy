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
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func withNotificationSocketPath(t *testing.T, path string) {
	t.Helper()
	old := proxyNotificationSocketPath
	proxyNotificationSocketPath = path
	t.Cleanup(func() { proxyNotificationSocketPath = old })
}

func TestStartNotificationListener(t *testing.T) {
	dir := t.TempDir()
	socketPath := filepath.Join(dir, "notify-test.sock")
	withNotificationSocketPath(t, socketPath)

	go startNotificationListener()
	time.Sleep(50 * time.Millisecond)

	// Verify the listener is up by hitting handleConfigUpdate
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"url":"http://refresh.example.com"}`))
	}))
	defer backend.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", backend.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	resp, err := client.Post("http://unix/config-updated", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /config-updated to notification listener: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("want 200, got %d", resp.StatusCode)
	}
}

// startRefresher starts startForwardURLRefresher with a cancellable context.
// It registers a t.Cleanup (called LAST, so runs FIRST in LIFO order) that
// cancels the context and waits for the goroutine to exit before other
// cleanups restore shared variables like backendDial and forwardURLRefreshInterval.
// Call startRefresher AFTER all other t.Cleanup registrations in each test.
func startRefresher(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		startForwardURLRefresher(ctx)
		close(done)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
		}
	})
}

func TestStartForwardURLRefresherFetchesURL(t *testing.T) {
	ensureClearCache(t)

	originalURL := getForwardURL()
	setForwardURL("")
	t.Cleanup(func() { setForwardURL(originalURL) })

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"url":"http://refreshed.example.com"}`))
	}))
	defer backend.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", backend.Listener.Addr().String())
	}
	t.Cleanup(func() { backendDial = originalDial })

	oldInterval := forwardURLRefreshInterval
	forwardURLRefreshInterval = 10 * time.Millisecond
	t.Cleanup(func() { forwardURLRefreshInterval = oldInterval })

	// startRefresher registered last so its cleanup (cancel+wait) runs first
	startRefresher(t)
	time.Sleep(100 * time.Millisecond)

	if getForwardURL() != "http://refreshed.example.com" {
		t.Errorf("want URL set by refresher, got %q", getForwardURL())
	}
}

func TestStartForwardURLRefresherSkipsWhenURLSet(t *testing.T) {
	originalURL := getForwardURL()
	setForwardURL("http://already-set.example.com")
	t.Cleanup(func() { setForwardURL(originalURL) })

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return nil, context.DeadlineExceeded
	}
	t.Cleanup(func() { backendDial = originalDial })

	oldInterval := forwardURLRefreshInterval
	forwardURLRefreshInterval = 10 * time.Millisecond
	t.Cleanup(func() { forwardURLRefreshInterval = oldInterval })

	startRefresher(t)
	time.Sleep(50 * time.Millisecond)

	if getForwardURL() != "http://already-set.example.com" {
		t.Errorf("want URL unchanged, got %q", getForwardURL())
	}
}

func TestStartForwardURLRefresherHandlesFetchError(t *testing.T) {
	originalURL := getForwardURL()
	setForwardURL("")
	t.Cleanup(func() { setForwardURL(originalURL) })

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return nil, context.DeadlineExceeded
	}
	t.Cleanup(func() { backendDial = originalDial })

	oldInterval := forwardURLRefreshInterval
	forwardURLRefreshInterval = 10 * time.Millisecond
	t.Cleanup(func() { forwardURLRefreshInterval = oldInterval })

	startRefresher(t)
	time.Sleep(50 * time.Millisecond)

	if getForwardURL() != "" {
		t.Errorf("want URL empty after fetch error, got %q", getForwardURL())
	}
}
