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

func TestExtractSourceIPHostPort(t *testing.T) {
	req := &http.Request{RemoteAddr: "10.0.0.5:4321"}
	if got := extractSourceIP(req); got != "10.0.0.5" {
		t.Fatalf("want host, got %q", got)
	}
}

func TestExtractSourceIPRawIP(t *testing.T) {
	req := &http.Request{RemoteAddr: "10.0.0.6"}
	if got := extractSourceIP(req); got != "10.0.0.6" {
		t.Fatalf("want raw ip, got %q", got)
	}
}
