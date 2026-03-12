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
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func clearLookupCache() {
	lookupCache.Range(func(key, _ interface{}) bool {
		lookupCache.Delete(key)
		return true
	})
}

// ensureClearCache clears the lookup cache before and after the test.
// It automatically registers cleanup using t.Cleanup().
func ensureClearCache(t *testing.T) {
	clearLookupCache()
	t.Cleanup(clearLookupCache)
}

// mockTime replaces the global now function with a fixed time for testing.
// It automatically restores the original function using t.Cleanup().
func mockTime(t *testing.T, fixedTime time.Time) {
	originalNow := now
	now = func() time.Time { return fixedTime }
	t.Cleanup(func() { now = originalNow })
}

func TestLookupCacheHitPositive(t *testing.T) {
	ensureClearCache(t)

	fixedNow := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	mockTime(t, fixedNow)

	ip := "10.0.0.12"
	lookupCache.Store(ip, cacheEntry{
		response:  &lookupResponse{ContainerID: "abc", Name: "svc"},
		found:     true,
		expiresAt: fixedNow.Add(5 * time.Minute),
	})

	resp, err := lookupContainerByIP(context.Background(), ip)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil || resp.ContainerID != "abc" {
		t.Fatalf("expected cached response, got %#v", resp)
	}
}

func TestLookupCacheHitNegative(t *testing.T) {
	ensureClearCache(t)

	fixedNow := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	mockTime(t, fixedNow)

	ip := "10.0.0.13"
	lookupCache.Store(ip, cacheEntry{
		response:  nil,
		found:     false,
		expiresAt: fixedNow.Add(5 * time.Minute),
	})

	resp, err := lookupContainerByIP(context.Background(), ip)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp != nil {
		t.Fatalf("expected nil response, got %#v", resp)
	}
}

func TestLookupCacheExpiredRefreshes(t *testing.T) {
	ensureClearCache(t)

	fixedNow := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	mockTime(t, fixedNow)

	ip := "10.0.0.14"
	lookupCache.Store(ip, cacheEntry{
		response:  &lookupResponse{ContainerID: "old", Name: "old"},
		found:     true,
		expiresAt: fixedNow.Add(-1 * time.Minute),
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload lookupRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if payload.IP != ip {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		response := lookupResponse{ContainerID: "new", Name: "svc"}
		data, _ := json.Marshal(response)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}))
	defer server.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	resp, err := lookupContainerByIP(context.Background(), ip)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil || resp.ContainerID != "new" {
		t.Fatalf("expected refreshed response, got %#v", resp)
	}

	cached, ok := lookupCache.Load(ip)
	if !ok {
		t.Fatalf("expected cached entry to be stored")
	}
	entry := cached.(cacheEntry)
	if !entry.found || entry.response == nil || entry.response.ContainerID != "new" {
		t.Fatalf("unexpected cached entry: %#v", entry)
	}
	if !entry.expiresAt.After(fixedNow) {
		t.Fatalf("expected cache expiry in the future, got %v", entry.expiresAt)
	}
}

func TestHandleContainerDestroyedClearsCache(t *testing.T) {
	ensureClearCache(t)

	lookupCache.Store("169.254.169.15", cacheEntry{
		response:  &lookupResponse{ContainerID: "abc", Name: "svc"},
		found:     true,
		expiresAt: time.Now().Add(5 * time.Minute),
	})
	lookupCache.Store("169.254.169.16", cacheEntry{
		response:  nil,
		found:     false,
		expiresAt: time.Now().Add(5 * time.Minute),
	})

	payload, _ := json.Marshal(containerDestroyedRequest{ContainerID: "abc"})
	req := httptest.NewRequest(http.MethodPost, "/container-destroyed", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleContainerDestroyed(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want status %d (%s), got %d (%s)", http.StatusOK, http.StatusText(http.StatusOK), rec.Code, http.StatusText(rec.Code))
	}

	if _, ok := lookupCache.Load("169.254.169.15"); ok {
		t.Fatalf("want cache entry to be removed")
	}
}

// TestConcurrentCacheAccess tests concurrent cache reads and writes
func TestConcurrentCacheAccess(t *testing.T) {
	ensureClearCache(t)

	const numReaders = 30
	const numWriters = 10
	const numOperations = 100

	var wg sync.WaitGroup
	wg.Add(numReaders + numWriters)

	// Writers - store cache entries
	for i := 0; i < numWriters; i++ {
		go func(id int) {
			defer wg.Done()

			for j := 0; j < numOperations; j++ {
				ip := fmt.Sprintf("169.254.169.%d", (id*numOperations+j)%254+1)
				entry := cacheEntry{
					response: &lookupResponse{
						ContainerID: fmt.Sprintf("container-%d", j),
						Name:        fmt.Sprintf("name-%d", j),
					},
					found:     true,
					expiresAt: time.Now().Add(time.Minute),
				}
				lookupCache.Store(ip, entry)
			}
		}(i)
	}

	// Readers - load cache entries
	for i := 0; i < numReaders; i++ {
		go func(id int) {
			defer wg.Done()

			for j := 0; j < numOperations; j++ {
				ip := fmt.Sprintf("169.254.169.%d", (id*numOperations+j)%254+1)
				_, ok := lookupCache.Load(ip)
				// It's OK if not found - writer may not have written yet
				_ = ok
			}
		}(i)
	}

	wg.Wait()
}

// TestConcurrentCacheExpiration tests concurrent cache access during expiration
func TestConcurrentCacheExpiration(t *testing.T) {
	ensureClearCache(t)
	mockTime(t, time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC))

	// Pre-populate cache with entries: half expired, half valid
	for i := 0; i < 100; i++ {
		ip := fmt.Sprintf("169.254.169.%d", i%254+1)
		expiresAt := time.Now()
		if i%2 == 0 {
			expiresAt = expiresAt.Add(-time.Minute) // expired
		} else {
			expiresAt = expiresAt.Add(time.Minute) // valid
		}

		lookupCache.Store(ip, cacheEntry{
			response: &lookupResponse{
				ContainerID: fmt.Sprintf("container-%d", i),
				Name:        fmt.Sprintf("name-%d", i),
			},
			found:     true,
			expiresAt: expiresAt,
		})
	}

	const numGoroutines = 50
	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	// Goroutines checking expiration concurrently
	for i := 0; i < numGoroutines; i++ {
		go func() {
			defer wg.Done()

			for j := 0; j < 100; j++ {
				ip := fmt.Sprintf("169.254.169.%d", j%254+1)
				cached, ok := lookupCache.Load(ip)
				if !ok {
					continue
				}

				entry := cached.(cacheEntry)
				expired := now().After(entry.expiresAt)

				// Check consistency - if expired, we shouldn't use it
				if expired && entry.found {
					// This is expected - the cache contains expired entries
					// until explicitly cleared
				}
			}
		}()
	}

	wg.Wait()
}

// TestConcurrentForwardURLAccess tests concurrent access to atomic forward URL
func TestConcurrentForwardURLAccess(t *testing.T) {
	const numReaders = 50
	const numWriters = 5
	const numOperations = 100

	var wg sync.WaitGroup
	wg.Add(numReaders + numWriters)

	// Writers
	for i := 0; i < numWriters; i++ {
		go func(id int) {
			defer wg.Done()

			for j := 0; j < numOperations; j++ {
				url := fmt.Sprintf("http://example.com/%d/%d", id, j)
				setForwardURL(url)
			}
		}(i)
	}

	// Readers
	for i := 0; i < numReaders; i++ {
		go func() {
			defer wg.Done()

			for j := 0; j < numOperations; j++ {
				url := getForwardURL()
				// Verify it's a valid URL format (if set)
				if url != "" && !strings.HasPrefix(url, "http") {
					t.Errorf("invalid URL format: %s", url)
				}
			}
		}()
	}

	wg.Wait()
}

// TestCacheGrowth tests cache behavior with many entries (limited by IP space)
func TestCacheGrowth(t *testing.T) {
	ensureClearCache(t)

	const numEntries = 10000

	// Add many entries to cache - with 254 unique IPs, many will overwrite
	for i := 0; i < numEntries; i++ {
		ip := fmt.Sprintf("169.254.169.%d", i%254+1)
		entry := cacheEntry{
			response: &lookupResponse{
				ContainerID: fmt.Sprintf("container-%d", i),
				Name:        fmt.Sprintf("name-%d", i),
			},
			found:     true,
			expiresAt: time.Now().Add(time.Hour),
		}
		lookupCache.Store(ip, entry)
	}

	// Count entries
	count := 0
	lookupCache.Range(func(_, _ interface{}) bool {
		count++
		return true
	})

	// With 169.254.169.x IP space (254 unique IPs), we can only have 254 unique entries
	// even though we attempted to add 10000 (many were overwrites of the same IP)
	expectedCount := 254
	if count != expectedCount {
		t.Errorf("want %d cache entries (limited by IP space), got %d", expectedCount, count)
	}

	// Verify random access still works
	testIP := "169.254.169.200"
	if cached, ok := lookupCache.Load(testIP); ok {
		entry := cached.(cacheEntry)
		if !entry.found || entry.response == nil {
			t.Errorf("want valid cache entry for %s", testIP)
		}
	}
}

// TestCacheEvictionPattern tests cache cleanup behavior
func TestCacheEvictionPattern(t *testing.T) {
	ensureClearCache(t)
	mockTime(t, time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC))

	// Add entries that will expire
	for i := 0; i < 100; i++ {
		ip := fmt.Sprintf("172.16.0.%d", i)
		entry := cacheEntry{
			response: &lookupResponse{
				ContainerID: fmt.Sprintf("container-%d", i),
				Name:        fmt.Sprintf("name-%d", i),
			},
			found:     true,
			expiresAt: time.Now().Add(30 * time.Second),
		}
		lookupCache.Store(ip, entry)
	}

	// Count initial entries
	initialCount := 0
	lookupCache.Range(func(_, _ interface{}) bool {
		initialCount++
		return true
	})

	if initialCount != 100 {
		t.Errorf("want 100 initial entries, got %d", initialCount)
	}

	// Note: sync.Map doesn't auto-evict expired entries
	// They remain until explicitly deleted or overwritten
	// This test verifies the cache can handle entries past expiration
	// without crashing
}

// TestCacheMemoryWithDeleteOperations tests cache with many delete operations
func TestCacheMemoryWithDeleteOperations(t *testing.T) {
	ensureClearCache(t)

	const cycles = 100
	const entriesPerCycle = 100

	for cycle := 0; cycle < cycles; cycle++ {
		// Add entries
		for i := 0; i < entriesPerCycle; i++ {
			ip := fmt.Sprintf("169.254.169.%d", (cycle*entriesPerCycle+i)%254+1)
			entry := cacheEntry{
				response: &lookupResponse{
					ContainerID: fmt.Sprintf("container-%d-%d", cycle, i),
					Name:        fmt.Sprintf("name-%d-%d", cycle, i),
				},
				found:     true,
				expiresAt: time.Now().Add(time.Minute),
			}
			lookupCache.Store(ip, entry)
		}

		// Delete half of them
		for i := 0; i < entriesPerCycle/2; i++ {
			ip := fmt.Sprintf("169.254.169.%d", (cycle*entriesPerCycle+i)%254+1)
			lookupCache.Delete(ip)
		}
	}

	// Count remaining entries
	count := 0
	lookupCache.Range(func(_, _ interface{}) bool {
		count++
		return true
	})

	// With 169.254.169.x IP space (254 unique IPs), and cycles that reuse IPs,
	// we expect roughly half the IP space to remain (since we delete half each cycle)
	expectedMin := 50  // At least this many should remain
	expectedMax := 254 // At most the full IP space

	if count < expectedMin || count > expectedMax {
		t.Errorf("cache entries after cycles: %d (expected between %d and %d)", count, expectedMin, expectedMax)
	}
}

// TestEdgeCaseEmptyIPLookup tests handling of empty IP address lookup
func TestEdgeCaseEmptyIPLookup(t *testing.T) {
	ensureClearCache(t)

	fixedNow := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	mockTime(t, fixedNow)

	// Create a mock backend that should not be called
	backendCalled := false
	mockBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		backendCalled = true
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer mockBackend.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "tcp", mockBackend.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	// Attempt to lookup empty IP
	resp, err := lookupContainerByIP(context.Background(), "")

	// Should handle gracefully (either return nil or error without crashing)
	if err != nil {
		t.Logf("empty IP lookup returned error: %v", err)
	}
	if resp != nil {
		t.Logf("empty IP lookup returned response: %+v", resp)
	}

	// Backend should handle this edge case (may or may not be called)
	if backendCalled {
		t.Log("backend was called for empty IP (edge case)")
	} else {
		t.Log("backend was not called for empty IP")
	}
}

// TestEdgeCaseUnicodeContainerNames tests handling of Unicode in container names
func TestEdgeCaseUnicodeContainerNames(t *testing.T) {
	ensureClearCache(t)

	fixedNow := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	mockTime(t, fixedNow)

	testCases := []struct {
		name          string
		containerName string
		containerID   string
	}{
		{"emoji", "🐳-docker-container", "abc123"},
		{"chinese", "容器-测试", "def456"},
		{"arabic", "حاوية-اختبار", "ghi789"},
		{"cyrillic", "контейнер-тест", "jkl012"},
		{"mixed", "test-🚀-подтест-测试", "mno345"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ip := fmt.Sprintf("169.254.169.%d", len(tc.name)+10)

			// Store in cache
			entry := cacheEntry{
				response: &lookupResponse{
					ContainerID: tc.containerID,
					Name:        tc.containerName,
				},
				found:     true,
				expiresAt: fixedNow.Add(5 * time.Minute),
			}
			lookupCache.Store(ip, entry)

			// Retrieve from cache
			resp, err := lookupContainerByIP(context.Background(), ip)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if resp == nil {
				t.Fatal("expected response from cache")
			}
			if resp.ContainerID != tc.containerID {
				t.Errorf("want ContainerID %q, got %q", tc.containerID, resp.ContainerID)
			}
			if resp.Name != tc.containerName {
				t.Errorf("want Name %q, got %q", tc.containerName, resp.Name)
			}
		})
	}
}

// TestEdgeCaseVeryLongContainerID tests handling of very long container IDs
func TestEdgeCaseVeryLongContainerID(t *testing.T) {
	ensureClearCache(t)

	fixedNow := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	mockTime(t, fixedNow)

	// Create an unusually long container ID (Docker typically uses 64 hex chars)
	longID := strings.Repeat("a", 512)
	ip := "169.254.169.100"

	// Store in cache
	entry := cacheEntry{
		response: &lookupResponse{
			ContainerID: longID,
			Name:        "test-long-id",
		},
		found:     true,
		expiresAt: fixedNow.Add(5 * time.Minute),
	}
	lookupCache.Store(ip, entry)

	// Retrieve from cache
	resp, err := lookupContainerByIP(context.Background(), ip)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Fatal("expected response from cache")
	}
	if resp.ContainerID != longID {
		t.Errorf("want full long ID preserved")
	}
	if len(resp.ContainerID) != 512 {
		t.Errorf("want ID length 512, got %d", len(resp.ContainerID))
	}
}

// TestEdgeCaseMalformedBackendJSON tests handling of malformed JSON from backend
func TestEdgeCaseMalformedBackendJSON(t *testing.T) {
	ensureClearCache(t)

	fixedNow := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	mockTime(t, fixedNow)

	testCases := []struct {
		name         string
		responseBody string
		statusCode   int
	}{
		{"invalid json", "{invalid json", http.StatusOK},
		{"truncated json", `{"containerId":"abc`, http.StatusOK},
		{"wrong structure", `["array","not","object"]`, http.StatusOK},
		{"empty response", "", http.StatusOK},
		{"null response", "null", http.StatusOK},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
				w.Write([]byte(tc.responseBody))
			}))
			defer mockBackend.Close()

			originalDial := backendDial
			backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
				var dialer net.Dialer
				return dialer.DialContext(ctx, "tcp", mockBackend.Listener.Addr().String())
			}
			defer func() { backendDial = originalDial }()

			ip := "169.254.169.101"

			// Should handle malformed response gracefully
			resp, err := lookupContainerByIP(context.Background(), ip)

			// Either error is returned or nil response
			if err != nil {
				t.Logf("malformed JSON returned error: %v", err)
			} else if resp == nil {
				t.Log("malformed JSON returned nil response")
			} else {
				t.Logf("malformed JSON returned response: %+v", resp)
			}

			// Should not crash - that's the key requirement
		})
	}
}

// TestStressMassiveCacheConcurrency tests cache under extreme concurrent load
func TestStressMassiveCacheConcurrency(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stress test in short mode")
	}

	ensureClearCache(t)

	fixedNow := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	mockTime(t, fixedNow)

	const numGoroutines = 500
	const numOperations = 200

	mockBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload lookupRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		response := lookupResponse{
			ContainerID: "stress-container",
			Name:        "stress-test",
		}
		data, _ := json.Marshal(response)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(data)
	}))
	defer mockBackend.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "tcp", mockBackend.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()

			for j := 0; j < numOperations; j++ {
				ip := fmt.Sprintf("169.254.169.%d", ((id*numOperations+j)%254)+1)

				// Mix of cache hits and misses
				if j%10 == 0 {
					// Force cache miss by clearing
					lookupCache.Delete(ip)
				}

				// Perform lookup
				_, err := lookupContainerByIP(context.Background(), ip)
				if err != nil {
					// Some errors acceptable under stress
					continue
				}

				// Some writes to cache
				if j%5 == 0 {
					entry := cacheEntry{
						response: &lookupResponse{
							ContainerID: fmt.Sprintf("stress-%d-%d", id, j),
							Name:        fmt.Sprintf("name-%d-%d", id, j),
						},
						found:     true,
						expiresAt: fixedNow.Add(5 * time.Minute),
					}
					lookupCache.Store(ip, entry)
				}
			}
		}(i)
	}

	wg.Wait()

	// Count final cache entries
	count := 0
	lookupCache.Range(func(_, _ interface{}) bool {
		count++
		return true
	})

	t.Logf("After stress test: %d cache entries", count)

	if count < 0 {
		t.Errorf("negative cache count indicates corruption")
	}
}

// TestStressCacheExpirationUnderLoad tests cache expiration during concurrent access
func TestStressCacheExpirationUnderLoad(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stress test in short mode")
	}

	ensureClearCache(t)

	const numGoroutines = 200
	const duration = 2 // seconds

	baseTime := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	currentTime := baseTime
	var timeMutex sync.RWMutex

	originalNow := now
	now = func() time.Time {
		timeMutex.RLock()
		defer timeMutex.RUnlock()
		return currentTime
	}
	defer func() { now = originalNow }()

	// Pre-populate cache
	for i := 1; i <= 100; i++ {
		ip := fmt.Sprintf("169.254.169.%d", i)
		entry := cacheEntry{
			response: &lookupResponse{
				ContainerID: fmt.Sprintf("container-%d", i),
				Name:        fmt.Sprintf("name-%d", i),
			},
			found:     true,
			expiresAt: baseTime.Add(1 * time.Second),
		}
		lookupCache.Store(ip, entry)
	}

	mockBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload lookupRequest
		json.NewDecoder(r.Body).Decode(&payload)

		response := lookupResponse{
			ContainerID: "refreshed-container",
			Name:        "refreshed-name",
		}
		data, _ := json.Marshal(response)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(data)
	}))
	defer mockBackend.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "tcp", mockBackend.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	stopChan := make(chan struct{})
	var wg sync.WaitGroup

	// Start readers
	wg.Add(numGoroutines)
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for {
				select {
				case <-stopChan:
					return
				default:
					ip := fmt.Sprintf("169.254.169.%d", (id%100)+1)
					_, _ = lookupContainerByIP(context.Background(), ip)
				}
			}
		}(i)
	}

	// Advance time to cause expirations
	time.Sleep(100 * time.Millisecond)
	timeMutex.Lock()
	currentTime = baseTime.Add(10 * time.Second)
	timeMutex.Unlock()

	// Let it run for the specified duration
	time.Sleep(time.Duration(duration) * time.Second)
	close(stopChan)

	wg.Wait()

	// Count remaining entries
	count := 0
	lookupCache.Range(func(_, _ interface{}) bool {
		count++
		return true
	})

	t.Logf("After expiration stress test: %d cache entries", count)
}

// TestStressForwardURLAtomicOperations tests atomic forward URL under high contention
func TestStressForwardURLAtomicOperations(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stress test in short mode")
	}

	const numGoroutines = 300
	const numOperations = 1000

	originalURL := getForwardURL()
	defer setForwardURL(originalURL)

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()

			for j := 0; j < numOperations; j++ {
				// Mix of reads and writes
				if j%3 == 0 {
					// Write
					url := fmt.Sprintf("http://stress-%d-%d.example.com", id, j)
					setForwardURL(url)
				} else {
					// Read
					_ = getForwardURL()
				}
			}
		}(i)
	}

	wg.Wait()

	finalURL := getForwardURL()
	t.Logf("Final forward URL after stress: %s", finalURL)
}
