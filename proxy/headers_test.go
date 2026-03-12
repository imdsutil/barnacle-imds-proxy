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
	"net/http"
	"testing"
)

func TestCopyHeadersDropsHopByHop(t *testing.T) {
	src := http.Header{}
	src.Set("Connection", "keep-alive")
	src.Set("Proxy-Connection", "keep-alive")
	src.Set("Keep-Alive", "timeout=5")
	src.Set("Proxy-Authenticate", "Basic")
	src.Set("Proxy-Authorization", "Basic abc")
	src.Set("Te", "trailers")
	src.Set("Trailer", "Expires")
	src.Set("Transfer-Encoding", "chunked")
	src.Set("Upgrade", "websocket")
	src.Set("X-Request-Id", "abc")

	dst := http.Header{}
	copyHeaders(dst, src)

	hopByHop := []string{
		"Connection",
		"Proxy-Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Te",
		"Trailer",
		"Transfer-Encoding",
		"Upgrade",
	}

	for _, header := range hopByHop {
		if value := dst.Get(header); value != "" {
			t.Fatalf("want %s to be dropped, got %q", header, value)
		}
	}

	if got := dst.Get("X-Request-Id"); got != "abc" {
		t.Fatalf("want X-Request-Id to be preserved, got %q", got)
	}
}

func TestCopyHeadersDropsConnectionTokens(t *testing.T) {
	src := http.Header{}
	src.Set("Connection", "X-Secret, Upgrade")
	src.Set("X-Secret", "should-not-forward")
	src.Set("Upgrade", "websocket")
	src.Set("X-Trace", "trace")

	dst := http.Header{}
	copyHeaders(dst, src)

	if value := dst.Get("X-Secret"); value != "" {
		t.Fatalf("want X-Secret to be dropped, got %q", value)
	}
	if value := dst.Get("Upgrade"); value != "" {
		t.Fatalf("want Upgrade to be dropped, got %q", value)
	}
	if got := dst.Get("X-Trace"); got != "trace" {
		t.Fatalf("want X-Trace to be preserved, got %q", got)
	}
}
