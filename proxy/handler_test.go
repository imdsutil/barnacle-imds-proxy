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
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleRequestNoForwardURL(t *testing.T) {
	originalURL := getForwardURL()
	setForwardURL("")
	t.Cleanup(func() { setForwardURL(originalURL) })

	req := httptest.NewRequest(http.MethodGet, "http://example.com/", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	rec := httptest.NewRecorder()

	handleRequest(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want status %d (%s), got %d (%s)", http.StatusServiceUnavailable, http.StatusText(http.StatusServiceUnavailable), rec.Code, http.StatusText(rec.Code))
	}
}

func TestHandleRequestLookupError(t *testing.T) {
	originalURL := getForwardURL()
	setForwardURL("http://example.com")
	t.Cleanup(func() { setForwardURL(originalURL) })

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return nil, errors.New("dial failed")
	}
	defer func() { backendDial = originalDial }()

	req := httptest.NewRequest(http.MethodGet, "http://example.com/", nil)
	req.RemoteAddr = "10.0.0.2:1234"
	rec := httptest.NewRecorder()

	handleRequest(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want status %d (%s), got %d (%s)", http.StatusBadGateway, http.StatusText(http.StatusBadGateway), rec.Code, http.StatusText(rec.Code))
	}
}

func TestHandleRequestContainerNotFound(t *testing.T) {
	originalURL := getForwardURL()
	setForwardURL("http://example.com")
	t.Cleanup(func() { setForwardURL(originalURL) })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	originalDial := backendDial
	backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	defer func() { backendDial = originalDial }()

	req := httptest.NewRequest(http.MethodGet, "http://example.com/", nil)
	req.RemoteAddr = "10.0.0.3:1234"
	rec := httptest.NewRecorder()

	handleRequest(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("want status %d (%s), got %d (%s)", http.StatusNotFound, http.StatusText(http.StatusNotFound), rec.Code, http.StatusText(rec.Code))
	}
}
