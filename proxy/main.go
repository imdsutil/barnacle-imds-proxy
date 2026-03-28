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
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const backendSocketPath = "/var/run/imds-proxy/backend.sock"

var proxyNotificationSocketPath = "/var/run/imds-proxy/notifications.sock"

const backendLookupPath = "http://unix/container-by-ip"

const backendSettingsPath = "http://unix/settings"

const readTimeout = 5 * time.Second

const writeTimeout = 5 * time.Second

const cacheTTL = 60 * time.Second

var forwardURL atomic.Value

var lookupCache sync.Map

var now = time.Now

var backendDial = func(ctx context.Context, _, _ string) (net.Conn, error) {
	var dialer net.Dialer
	return dialer.DialContext(ctx, "unix", backendSocketPath)
}

type cacheEntry struct {
	response  *lookupResponse
	found     bool
	expiresAt time.Time
}

type settingsResponse struct {
	URL string `json:"url"`
}

type lookupRequest struct {
	IP string `json:"ip"`
}

type lookupResponse struct {
	ContainerID string            `json:"containerId"`
	Name        string            `json:"name"`
	Labels      map[string]string `json:"labels"`
}

func main() {
	log.SetOutput(os.Stdout)

	// Fetch the forward URL from backend
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	url, err := fetchForwardURL(ctx)
	cancel()

	if err != nil {
		log.Printf("Warning: Failed to fetch forward URL from backend: %v", err)
		setForwardURL("")
	} else {
		setForwardURL(url)
		log.Printf("Forward URL configured: %s", getForwardURL())
	}

	go startForwardURLRefresher(context.Background())

	// Start notification listener for config updates from backend
	go startNotificationListener()

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleRequest)

	server := &http.Server{
		Addr:              ":80",
		Handler:           mux,
		ReadHeaderTimeout: readTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
	}

	log.Printf("IMDS proxy listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("HTTP server error: %v", err)
	}
}

func handleRequest(w http.ResponseWriter, r *http.Request) {
	sourceIP := extractSourceIP(r)
	log.Printf("Received %s %s from %s", r.Method, r.URL.Path, sourceIP)

	// Check if forward URL is configured
	if getForwardURL() == "" {
		log.Printf("No forward URL configured")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("forward URL not configured"))
		return
	}

	// Lookup container by IP
	containerInfo, err := lookupContainerByIP(r.Context(), sourceIP)
	if err != nil {
		log.Printf("Lookup failed for %s: %v", sourceIP, err)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("lookup failed"))
		return
	}

	if containerInfo == nil {
		log.Printf("No container found for %s", sourceIP)
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("container not found"))
		return
	}

	log.Printf("Container lookup for %s: id=%s name=%s labels=%v", sourceIP, containerInfo.ContainerID, containerInfo.Name, containerInfo.Labels)

	// Forward request to configured URL with container info headers
	if err := forwardRequest(w, r, containerInfo); err != nil {
		log.Printf("Failed to forward request: %v", err)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("forward failed"))
		return
	}
}

func forwardRequest(w http.ResponseWriter, originalReq *http.Request, containerInfo *lookupResponse) error {
	// Build target URL, replacing localhost with host.docker.internal
	targetURL := getForwardURL()
	targetURL = strings.Replace(targetURL, "://localhost", "://host.docker.internal", 1)
	targetURL += originalReq.URL.Path
	if originalReq.URL.RawQuery != "" {
		targetURL += "?" + originalReq.URL.RawQuery
	}

	// Create new request
	req, err := http.NewRequestWithContext(originalReq.Context(), originalReq.Method, targetURL, originalReq.Body)
	if err != nil {
		return err
	}

	// Copy original headers, excluding hop-by-hop
	copyHeaders(req.Header, originalReq.Header)

	// Add container info headers
	req.Header.Set("x-container-id", containerInfo.ContainerID)
	req.Header.Set("x-container-name", containerInfo.Name)

	// Encode labels as JSON
	if len(containerInfo.Labels) > 0 {
		labelsJSON, err := json.Marshal(containerInfo.Labels)
		if err != nil {
			log.Printf("Warning: Failed to encode labels as JSON: %v", err)
		} else {
			req.Header.Set("x-container-labels", string(labelsJSON))
		}
	}

	// Forward the request
	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse // Don't follow redirects
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Copy response headers, excluding hop-by-hop
	copyHeaders(w.Header(), resp.Header)

	// Copy response status
	w.WriteHeader(resp.StatusCode)

	// Copy response body
	_, err = io.Copy(w, resp.Body)
	return err
}

func extractSourceIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}

	return r.RemoteAddr
}

func lookupContainerByIP(ctx context.Context, ip string) (*lookupResponse, error) {
	// Check cache first
	if cached, ok := lookupCache.Load(ip); ok {
		entry := cached.(cacheEntry)
		if now().Before(entry.expiresAt) {
			log.Printf("Cache hit for IP %s", ip)
			if entry.found {
				return entry.response, nil
			}
			return nil, nil
		}
		lookupCache.Delete(ip)
	}

	log.Printf("Cache miss for IP %s, performing lookup", ip)

	payload, err := json.Marshal(lookupRequest{IP: ip})
	if err != nil {
		return nil, err
	}

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: backendDial,
		},
		Timeout: 5 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, backendLookupPath, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusNotFound {
		lookupCache.Store(ip, cacheEntry{
			response:  nil,
			found:     false,
			expiresAt: now().Add(cacheTTL),
		})
		log.Printf("Cached negative lookup for IP %s", ip)
		return nil, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, errors.New(string(body))
	}

	var response lookupResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}

	// Store in cache
	lookupCache.Store(ip, cacheEntry{
		response:  &response,
		found:     true,
		expiresAt: now().Add(cacheTTL),
	})
	log.Printf("Cached lookup result for IP %s", ip)

	return &response, nil
}

func fetchForwardURL(ctx context.Context) (string, error) {
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: backendDial,
		},
		Timeout: 10 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, backendSettingsPath, nil)
	if err != nil {
		return "", err
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", errors.New(string(body))
	}

	var settings settingsResponse
	if err := json.Unmarshal(body, &settings); err != nil {
		return "", err
	}

	return settings.URL, nil
}

func startNotificationListener() {
	_ = os.RemoveAll(proxyNotificationSocketPath)

	listener, err := net.Listen("unix", proxyNotificationSocketPath)
	if err != nil {
		log.Printf("Failed to listen on notification socket %s: %v", proxyNotificationSocketPath, err)
		return
	}
	defer listener.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/config-updated", handleConfigUpdate)
	mux.HandleFunc("/container-destroyed", handleContainerDestroyed)

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: readTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
	}

	log.Printf("Notification listener started on %s", proxyNotificationSocketPath)
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("Notification listener error: %v", err)
	}
}

func handleConfigUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	url, err := fetchForwardURL(ctx)
	if err != nil {
		log.Printf("Failed to fetch updated forward URL: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	if url != getForwardURL() {
		setForwardURL(url)
		log.Printf("Forward URL updated: %s", getForwardURL())
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

type containerDestroyedRequest struct {
	ContainerID string `json:"containerId"`
}

func handleContainerDestroyed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req containerDestroyedRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Failed to decode container destroyed request: %v", err)
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if req.ContainerID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// Remove all cache entries for this container
	count := 0
	lookupCache.Range(func(key, value interface{}) bool {
		entry := value.(cacheEntry)
		if entry.response != nil && entry.response.ContainerID == req.ContainerID {
			lookupCache.Delete(key)
			count++
		}
		return true
	})

	containerID := req.ContainerID
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}
	log.Printf("Container %s destroyed, removed %d cache entries", containerID, count)

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func getForwardURL() string {
	value := forwardURL.Load()
	if value == nil {
		return ""
	}
	return value.(string)
}

func setForwardURL(url string) {
	forwardURL.Store(url)
}

var forwardURLRefreshInterval = 10 * time.Second

func startForwardURLRefresher(ctx context.Context) {
	ticker := time.NewTicker(forwardURLRefreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		if getForwardURL() != "" {
			continue
		}

		fetchCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		url, err := fetchForwardURL(fetchCtx)
		cancel()

		if err != nil {
			log.Printf("Warning: Failed to refresh forward URL: %v", err)
			continue
		}

		if url != "" {
			setForwardURL(url)
			log.Printf("Forward URL configured: %s", getForwardURL())
		}
	}
}

func copyHeaders(dst, src http.Header) {
	hopByHop := map[string]struct{}{
		"Connection":          {},
		"Proxy-Connection":    {},
		"Keep-Alive":          {},
		"Proxy-Authenticate":  {},
		"Proxy-Authorization": {},
		"Te":                  {},
		"Trailer":             {},
		"Transfer-Encoding":   {},
		"Upgrade":             {},
	}

	for key, values := range src {
		if _, ok := hopByHop[key]; ok {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}

	if connection := src.Get("Connection"); connection != "" {
		for _, token := range strings.Split(connection, ",") {
			if token = strings.TrimSpace(token); token != "" {
				dst.Del(token)
			}
		}
	}
}
