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
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Response struct {
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
	Path      string    `json:"path"`
	Method    string    `json:"method"`
}

func handler(w http.ResponseWriter, r *http.Request) {
	trackRequest(r)
	for k, v := range r.Header {
		w.Header().Set("X-Echo-"+k, v[0])
	}

	response := Response{
		Message:   "Hello from test server!",
		Timestamp: time.Now(),
		Path:      r.URL.Path,
		Method:    r.Method,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
	}

	log.Printf("%s %s - 200 OK", r.Method, r.URL.Path)
	log.Printf("Headers: %v", r.Header)
}

func logoHandler(w http.ResponseWriter, r *http.Request) {
	logoPath := filepath.Join("..", "logo.svg")

	data, err := os.ReadFile(logoPath)
	if err != nil {
		log.Printf("Error reading logo.svg: %v", err)
		http.Error(w, "Logo not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "image/svg+xml")
	w.WriteHeader(http.StatusOK)
	w.Write(data)

	log.Printf("%s %s - 200 OK (served logo.svg)", r.Method, r.URL.Path)
	log.Printf("Headers: %v", r.Header)
}

var (
	mu             sync.Mutex
	totalRequests  int
	proxiedRequests int
	lastProxied    time.Time
	containers     = make(map[string]string) // id -> name
)

func trackRequest(r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	totalRequests++
	if id := r.Header.Get("X-Container-Id"); id != "" {
		proxiedRequests++
		lastProxied = time.Now()
		containers[id] = r.Header.Get("X-Container-Name")
	}
}

type StatusResponse struct {
	TotalRequests   int               `json:"total_requests"`
	ProxiedRequests int               `json:"proxied_requests"`
	LastProxied     string            `json:"last_proxied,omitempty"`
	Containers      map[string]string `json:"containers"`
}

func statusHandler(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	resp := StatusResponse{
		TotalRequests:   totalRequests,
		ProxiedRequests: proxiedRequests,
		Containers:      containers,
	}
	if !lastProxied.IsZero() {
		resp.LastProxied = lastProxied.Format(time.RFC3339)
	}
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func imdsRoleHandler(w http.ResponseWriter, r *http.Request) {
	trackRequest(r)
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("test-role"))

	log.Printf("%s %s - 200 OK (IMDS role endpoint)", r.Method, r.URL.Path)
	log.Printf("Headers: %v", r.Header)
}

func main() {
	port := flag.Int("port", 8080, "Port to listen on")
	flag.Parse()

	addr := fmt.Sprintf(":%d", *port)

	http.HandleFunc("/status", statusHandler)
	http.HandleFunc("/latest/meta-data/iam/security-credentials/", imdsRoleHandler)
	http.HandleFunc("/logo.svg", logoHandler)
	http.HandleFunc("/", handler)

	log.Printf("Test server starting on http://localhost%s", addr)
	log.Printf("Try: curl http://localhost%s/test", addr)

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatal(err)
	}
}
