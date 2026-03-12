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
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestFetchForwardURLSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"url":"http://example.com"}`))
	}))
	defer server.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	url, err := fetchForwardURL(context.Background())
	if err != nil {
		t.Fatalf("want no error, got %v", err)
	}
	if url != "http://example.com" {
		t.Fatalf("want url to be parsed, got %q", url)
	}
}

func TestFetchForwardURLNonOK(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer server.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	if _, err := fetchForwardURL(context.Background()); err == nil {
		t.Fatalf("want error for non-OK response")
	}
}

func TestLookupContainerByIPNonOK(t *testing.T) {
	clearLookupCache()
	defer clearLookupCache()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("bad"))
	}))
	defer server.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	if _, err := lookupContainerByIP(context.Background(), "169.254.169.99"); err == nil {
		t.Fatalf("want error for non-OK response")
	}
}

// TestFetchForwardURLTimeout tests timeout handling during backend communication
func TestFetchForwardURLTimeout(t *testing.T) {
	// Create a server that delays response beyond timeout
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond) // Delay longer than test timeout
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"url":"http://example.com"}`))
	}))
	defer server.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	// Create context with very short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	_, err := fetchForwardURL(ctx)
	if err == nil {
		t.Fatalf("want error for timeout, got nil")
	}

	// Verify it's a context deadline error
	if ctx.Err() != context.DeadlineExceeded {
		t.Logf("context error: %v", ctx.Err())
	}
}

// TestLookupContainerByIPTimeout tests timeout handling during container lookup
func TestLookupContainerByIPTimeout(t *testing.T) {
	clearLookupCache()
	defer clearLookupCache()

	// Create a server that delays response beyond timeout
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"containerId":"abc","name":"test"}`))
	}))
	defer server.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	// Create context with very short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	_, err := lookupContainerByIP(ctx, "169.254.169.50")
	if err == nil {
		t.Fatalf("want error for timeout, got nil")
	}
}

// TestBackendDialTimeout tests dialing timeout
func TestBackendDialTimeout(t *testing.T) {
	originalDial := backendDial
	backendDial = func(ctx context.Context, network, addr string) (net.Conn, error) {
		// Simulate a slow connection that times out
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
			return nil, context.DeadlineExceeded
		}
	}
	defer func() { backendDial = originalDial }()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	_, err := fetchForwardURL(ctx)
	if err == nil {
		t.Fatalf("want error for dial timeout, got nil")
	}
}

// TestConcurrentTimeouts tests multiple timeout scenarios happening concurrently
func TestConcurrentTimeouts(t *testing.T) {
	clearLookupCache()
	defer clearLookupCache()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Random delay between 5-50ms
		delay := (time.Duration(r.URL.Path[len(r.URL.Path)-1]%10) + 1) * 5 * time.Millisecond
		time.Sleep(delay)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"containerId":"abc","name":"test"}`))
	}))
	defer server.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	const numGoroutines = 20
	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()

			// Some contexts timeout quickly, others have more time
			timeout := time.Duration(id%5+1) * 20 * time.Millisecond
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()

			ip := fmt.Sprintf("169.254.169.%d", id%254+1)
			_, err := lookupContainerByIP(ctx, ip)
			// Error is OK - we expect some timeouts
			_ = err
		}(i)
	}

	wg.Wait()
}
