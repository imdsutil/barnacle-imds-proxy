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
	"fmt"
	"testing"
	"time"
)

// BenchmarkCacheWrite measures cache write performance
func BenchmarkCacheWrite(b *testing.B) {
	clearLookupCache()
	defer clearLookupCache()

	fixedTime := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ip := fmt.Sprintf("169.254.169.%d", (i%254)+1)
		entry := cacheEntry{
			response: &lookupResponse{
				ContainerID: fmt.Sprintf("bench-%d", i),
				Name:        fmt.Sprintf("name-%d", i),
			},
			found:     true,
			expiresAt: fixedTime.Add(5 * time.Minute),
		}
		lookupCache.Store(ip, entry)
	}
}

// BenchmarkCacheRead measures cache read performance
func BenchmarkCacheRead(b *testing.B) {
	clearLookupCache()
	defer clearLookupCache()

	fixedTime := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)

	// Pre-populate cache
	for i := 0; i < 100; i++ {
		ip := fmt.Sprintf("169.254.169.%d", (i%254)+1)
		entry := cacheEntry{
			response: &lookupResponse{
				ContainerID: fmt.Sprintf("container-%d", i),
				Name:        fmt.Sprintf("name-%d", i),
			},
			found:     true,
			expiresAt: fixedTime.Add(5 * time.Minute),
		}
		lookupCache.Store(ip, entry)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ip := fmt.Sprintf("169.254.169.%d", (i%100)%254+1)
		_, _ = lookupCache.Load(ip)
	}
}

// BenchmarkCacheReadWrite measures mixed read/write performance
func BenchmarkCacheReadWrite(b *testing.B) {
	clearLookupCache()
	defer clearLookupCache()

	fixedTime := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ip := fmt.Sprintf("169.254.169.%d", (i%254)+1)

		if i%3 == 0 {
			// Write
			entry := cacheEntry{
				response: &lookupResponse{
					ContainerID: fmt.Sprintf("rw-%d", i),
					Name:        fmt.Sprintf("name-%d", i),
				},
				found:     true,
				expiresAt: fixedTime.Add(5 * time.Minute),
			}
			lookupCache.Store(ip, entry)
		} else {
			// Read
			_, _ = lookupCache.Load(ip)
		}
	}
}

// BenchmarkForwardURLAtomic measures atomic forward URL operations
func BenchmarkForwardURLAtomic(b *testing.B) {
	originalURL := getForwardURL()
	defer setForwardURL(originalURL)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if i%5 == 0 {
			url := fmt.Sprintf("http://bench-%d.example.com", i)
			setForwardURL(url)
		} else {
			_ = getForwardURL()
		}
	}
}

// BenchmarkConcurrentCacheReads measures concurrent cache read performance
func BenchmarkConcurrentCacheReads(b *testing.B) {
	clearLookupCache()
	defer clearLookupCache()

	fixedTime := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)

	// Pre-populate cache
	for i := 0; i < 100; i++ {
		ip := fmt.Sprintf("169.254.169.%d", (i%254)+1)
		entry := cacheEntry{
			response: &lookupResponse{
				ContainerID: fmt.Sprintf("concurrent-%d", i),
				Name:        fmt.Sprintf("name-%d", i),
			},
			found:     true,
			expiresAt: fixedTime.Add(5 * time.Minute),
		}
		lookupCache.Store(ip, entry)
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			ip := fmt.Sprintf("169.254.169.%d", (i%100)%254+1)
			_, _ = lookupCache.Load(ip)
			i++
		}
	})
}

// BenchmarkConcurrentCacheReadWrite measures concurrent mixed operations
func BenchmarkConcurrentCacheReadWrite(b *testing.B) {
	clearLookupCache()
	defer clearLookupCache()

	fixedTime := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			ip := fmt.Sprintf("169.254.169.%d", (i%254)+1)

			if i%5 == 0 {
				// Write
				entry := cacheEntry{
					response: &lookupResponse{
						ContainerID: fmt.Sprintf("concurrent-rw-%d", i),
						Name:        fmt.Sprintf("name-%d", i),
					},
					found:     true,
					expiresAt: fixedTime.Add(5 * time.Minute),
				}
				lookupCache.Store(ip, entry)
			} else {
				// Read
				_, _ = lookupCache.Load(ip)
			}
			i++
		}
	})
}
