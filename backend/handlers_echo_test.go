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
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/docker/docker/api/types/container"
	"github.com/labstack/echo/v4"
)

func withNoOpNotify(t *testing.T) {
	t.Helper()
	old := notifyProxyConfigUpdateFn
	notifyProxyConfigUpdateFn = func() {}
	t.Cleanup(func() { notifyProxyConfigUpdateFn = old })
}

func withTempSettingsPath(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	old := settingsPath
	settingsPath = filepath.Join(dir, "settings.json")
	t.Cleanup(func() { settingsPath = old })
}

func withSettings(t *testing.T, s Settings) {
	t.Helper()
	settingsMutex.Lock()
	settings = s
	settingsMutex.Unlock()
	t.Cleanup(func() {
		settingsMutex.Lock()
		settings = Settings{}
		settingsMutex.Unlock()
	})
}

func TestHello(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/hello", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := hello(c); err != nil {
		t.Fatalf("hello() returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("want status 200, got %d", rec.Code)
	}
}

func TestGetSettings(t *testing.T) {
	withSettings(t, Settings{URL: "http://test.example.com"})

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := getSettings(c); err != nil {
		t.Fatalf("getSettings() returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("want status 200, got %d", rec.Code)
	}

	var got Settings
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got.URL != "http://test.example.com" {
		t.Errorf("want URL %q, got %q", "http://test.example.com", got.URL)
	}
}

func TestSaveSettingsValid(t *testing.T) {
	withTempSettingsPath(t)
	withSettings(t, Settings{})
	withNoOpNotify(t)

	e := echo.New()
	body := strings.NewReader(`{"url":"http://example.com"}`)
	req := httptest.NewRequest(http.MethodPost, "/settings", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := saveSettings(c); err != nil {
		t.Fatalf("saveSettings() returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("want status 200, got %d", rec.Code)
	}

	settingsMutex.RLock()
	gotURL := settings.URL
	settingsMutex.RUnlock()
	if gotURL != "http://example.com" {
		t.Errorf("want settings URL %q, got %q", "http://example.com", gotURL)
	}
}

func TestSaveSettingsEmptyURL(t *testing.T) {
	withTempSettingsPath(t)

	e := echo.New()
	body := strings.NewReader(`{"url":""}`)
	req := httptest.NewRequest(http.MethodPost, "/settings", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := saveSettings(c); err != nil {
		t.Fatalf("saveSettings() returned error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want status 400, got %d", rec.Code)
	}
}

func TestSaveSettingsInvalidJSON(t *testing.T) {
	withTempSettingsPath(t)

	e := echo.New()
	body := strings.NewReader(`not-json`)
	req := httptest.NewRequest(http.MethodPost, "/settings", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := saveSettings(c); err != nil {
		t.Fatalf("saveSettings() returned error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want status 400, got %d", rec.Code)
	}
}

func TestGetContainersEmpty(t *testing.T) {
	resetTracking()
	t.Cleanup(resetTracking)
	withDockerClient(t, &fakeDockerClient{})

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/containers", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := getContainers(c); err != nil {
		t.Fatalf("getContainers() returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("want status 200, got %d", rec.Code)
	}

	var result ContainersAPIResponse
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(result.Containers) != 0 {
		t.Errorf("want empty containers, got %d items", len(result.Containers))
	}
}

func TestGetContainersWithData(t *testing.T) {
	resetTracking()
	t.Cleanup(resetTracking)
	withDockerClient(t, &fakeDockerClient{})

	trackedContainersMutex.Lock()
	trackedContainers["abc"] = ContainerInfo{
		ContainerID: "abc",
		Name:        "/test",
		Labels:      map[string]string{},
		Networks:    []NetworkInfo{{NetworkName: ".imds_aws_gcp", NetworkID: "net1"}},
	}
	trackedContainersMutex.Unlock()

	managedNetworksMutex.Lock()
	managedNetworks = []ImdsNetworkStatus{{NetworkName: ".imds_aws_gcp", Providers: []string{"AWS", "GCP"}}}
	managedNetworksMutex.Unlock()
	t.Cleanup(func() {
		managedNetworksMutex.Lock()
		managedNetworks = nil
		managedNetworksMutex.Unlock()
	})

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/containers", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := getContainers(c); err != nil {
		t.Fatalf("getContainers() returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("want status 200, got %d", rec.Code)
	}

	var result ContainersAPIResponse
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(result.Containers) != 1 {
		t.Fatalf("want 1 container, got %d", len(result.Containers))
	}
	if len(result.Containers[0].ImdsNetworks) != 1 {
		t.Fatalf("want 1 imds network, got %d", len(result.Containers[0].ImdsNetworks))
	}
	if !result.Containers[0].ImdsNetworks[0].Connected {
		t.Errorf("want ImdsNetworks[0].Connected=true for .imds_aws_gcp")
	}
}

func TestGetProxyComposeSuccess(t *testing.T) {
	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "compose.yaml")
	content := []byte("version: '3'\nservices:\n  proxy:\n    image: test\n")
	if err := os.WriteFile(yamlPath, content, 0644); err != nil {
		t.Fatal(err)
	}

	old := proxyComposePath
	proxyComposePath = yamlPath
	t.Cleanup(func() { proxyComposePath = old })

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy-compose", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := getProxyCompose(c); err != nil {
		t.Fatalf("getProxyCompose() returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("want status 200, got %d", rec.Code)
	}
	if rec.Body.String() != string(content) {
		t.Errorf("want yaml content %q, got %q", string(content), rec.Body.String())
	}
}

func TestGetProxyComposeMissing(t *testing.T) {
	old := proxyComposePath
	proxyComposePath = "/nonexistent/path/compose.yaml"
	t.Cleanup(func() { proxyComposePath = old })

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy-compose", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := getProxyCompose(c); err != nil {
		t.Fatalf("getProxyCompose() returned error: %v", err)
	}

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want status 500, got %d", rec.Code)
	}
}

func TestGetComposeProjectNameSuccess(t *testing.T) {
	cli := &fakeDockerClient{
		inspectSequence: []container.InspectResponse{
			{
				Config: &container.Config{
					Labels: map[string]string{
						"com.docker.compose.project":            "barnacle-imds-proxy",
						"com.docker.compose.project.config_files": "/path/to/docker-compose.yaml",
					},
				},
			},
		},
	}
	withDockerClient(t, cli)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/compose-project-name", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := getComposeProjectName(c); err != nil {
		t.Fatalf("getComposeProjectName() returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("want status 200, got %d", rec.Code)
	}

	var got map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got["projectName"] != "barnacle-imds-proxy" {
		t.Errorf("want projectName %q, got %q", "barnacle-imds-proxy", got["projectName"])
	}
	if got["configFiles"] != "/path/to/docker-compose.yaml" {
		t.Errorf("want configFiles %q, got %q", "/path/to/docker-compose.yaml", got["configFiles"])
	}
}

func TestGetComposeProjectNameMissingLabel(t *testing.T) {
	cli := &fakeDockerClient{
		inspectSequence: []container.InspectResponse{
			{Config: &container.Config{Labels: map[string]string{}}},
		},
	}
	withDockerClient(t, cli)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/compose-project-name", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := getComposeProjectName(c); err != nil {
		t.Fatalf("getComposeProjectName() returned error: %v", err)
	}

	if rec.Code != http.StatusNotFound {
		t.Fatalf("want status 404, got %d", rec.Code)
	}
}

func TestGetComposeProjectNameInspectError(t *testing.T) {
	cli := &fakeDockerClient{inspectErr: errors.New("container not found")}
	withDockerClient(t, cli)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/compose-project-name", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := getComposeProjectName(c); err != nil {
		t.Fatalf("getComposeProjectName() returned error: %v", err)
	}

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want status 500, got %d", rec.Code)
	}
}

func TestHandleProxyGetSettingsSuccess(t *testing.T) {
	withSettings(t, Settings{URL: "http://proxy.example.com"})

	req := httptest.NewRequest(http.MethodGet, "/settings", nil)
	rec := httptest.NewRecorder()

	handleProxyGetSettings(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want status 200, got %d", rec.Code)
	}

	var got Settings
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got.URL != "http://proxy.example.com" {
		t.Errorf("want URL %q, got %q", "http://proxy.example.com", got.URL)
	}
}
