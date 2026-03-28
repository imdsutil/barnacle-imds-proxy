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
	"strings"
	"testing"
	"time"
)

// --- handleConfigUpdate ---

func TestHandleConfigUpdateMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/config-updated", nil)
	rec := httptest.NewRecorder()

	handleConfigUpdate(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("want status 405, got %d", rec.Code)
	}
}

func TestHandleConfigUpdateSuccess(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"url":"http://new-imds.example.com"}`))
	}))
	defer backend.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", backend.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	originalURL := getForwardURL()
	setForwardURL("http://old.example.com")
	t.Cleanup(func() { setForwardURL(originalURL) })

	req := httptest.NewRequest(http.MethodPost, "/config-updated", nil)
	rec := httptest.NewRecorder()

	handleConfigUpdate(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("want status 200, got %d", rec.Code)
	}
	if getForwardURL() != "http://new-imds.example.com" {
		t.Errorf("want URL updated to new-imds.example.com, got %q", getForwardURL())
	}
}

func TestHandleConfigUpdateSameURL(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"url":"http://same.example.com"}`))
	}))
	defer backend.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", backend.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	originalURL := getForwardURL()
	setForwardURL("http://same.example.com")
	t.Cleanup(func() { setForwardURL(originalURL) })

	req := httptest.NewRequest(http.MethodPost, "/config-updated", nil)
	rec := httptest.NewRecorder()

	handleConfigUpdate(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("want status 200, got %d", rec.Code)
	}
}

func TestHandleConfigUpdateFetchError(t *testing.T) {
	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return nil, context.DeadlineExceeded
	}
	defer func() { backendDial = originalDial }()

	req := httptest.NewRequest(http.MethodPost, "/config-updated", nil)
	rec := httptest.NewRecorder()

	handleConfigUpdate(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("want status 500, got %d", rec.Code)
	}
}

// --- handleContainerDestroyed ---

func TestHandleContainerDestroyedMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/container-destroyed", nil)
	rec := httptest.NewRecorder()

	handleContainerDestroyed(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("want status 405, got %d", rec.Code)
	}
}

func TestHandleContainerDestroyedInvalidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/container-destroyed", strings.NewReader("not-json"))
	rec := httptest.NewRecorder()

	handleContainerDestroyed(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("want status 400, got %d", rec.Code)
	}
}

func TestHandleContainerDestroyedEmptyID(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/container-destroyed", strings.NewReader(`{"containerId":""}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleContainerDestroyed(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("want status 400, got %d", rec.Code)
	}
}

func TestHandleContainerDestroyedSuccess(t *testing.T) {
	ensureClearCache(t)

	// Pre-populate cache with an entry for this container
	ip := "169.254.169.100"
	lookupCache.Store(ip, cacheEntry{
		response:  &lookupResponse{ContainerID: "abc123def456", Name: "/my-app"},
		found:     true,
		expiresAt: time.Now().Add(cacheTTL),
	})

	req := httptest.NewRequest(http.MethodPost, "/container-destroyed",
		strings.NewReader(`{"containerId":"abc123def456"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleContainerDestroyed(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("want status 200, got %d", rec.Code)
	}
	if _, ok := lookupCache.Load(ip); ok {
		t.Error("want cache entry removed after container destroyed notification")
	}
}

func TestHandleContainerDestroyedShortID(t *testing.T) {
	ensureClearCache(t)

	req := httptest.NewRequest(http.MethodPost, "/container-destroyed",
		strings.NewReader(`{"containerId":"short"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleContainerDestroyed(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("want status 200 for short container ID, got %d", rec.Code)
	}
}
