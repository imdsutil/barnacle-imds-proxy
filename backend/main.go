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
	"flag"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/sirupsen/logrus"
)

var logger = logrus.New()

const (
	proxySocketPath    = "/var/run/imds-proxy/backend.sock"
	imdsManagedLabel   = "imds-proxy.managed"
	imdsProvidersLabel = "imds-proxy.providers"
	proxyContainerName = "imds-proxy"
)

type ProxyContainerState string

const (
	ProxyStateRunning ProxyContainerState = "running"
	ProxyStatePaused  ProxyContainerState = "paused"
	ProxyStateStopped ProxyContainerState = "stopped"
	ProxyStateFailed  ProxyContainerState = "failed"
	ProxyStateMissing ProxyContainerState = "missing"
)

var proxyNotificationSocketPath = "/var/run/imds-proxy/notifications.sock"

type Settings struct {
	URL string `json:"url"`
}

type ProxyLookupRequest struct {
	IP string `json:"ip"`
}

type ProxyLookupResponse struct {
	ContainerID string            `json:"containerId"`
	Name        string            `json:"name"`
	Labels      map[string]string `json:"labels"`
}

type NetworkInfo struct {
	NetworkID   string `json:"networkId"`
	NetworkName string `json:"networkName"`
}

// ImdsNetwork is the internal representation of a managed IMDS network.
// Providers maps provider name (e.g. "AWS") to the protocols it carries on
// this network (e.g. ["v4", "v6"]).
type ImdsNetwork struct {
	NetworkName string
	Providers   map[string][]string
}

// ProviderStatus is the per-container API representation of a cloud provider's
// proxying state across all managed networks.
type ProviderStatus struct {
	Name          string `json:"name"`
	IPv4Connected bool   `json:"ipv4Connected"`
	IPv6Connected bool   `json:"ipv6Connected"`
}

type ContainerInfo struct {
	ContainerID string            `json:"containerId"`
	Name        string            `json:"name"`
	Labels      map[string]string `json:"labels"`
	Networks    []NetworkInfo     `json:"-"`
	Providers   []ProviderStatus  `json:"providers"`
}

type ContainersAPIResponse struct {
	Containers  []ContainerInfo     `json:"containers"`
	ProxyStatus ProxyContainerState `json:"proxyStatus"`
}

var (
	settings         Settings
	settingsMutex    sync.RWMutex
	settingsPath     = "/data/settings.json"
	proxyComposePath = "/imds-proxy-compose.yaml"

	trackedContainers      = make(map[string]ContainerInfo)
	trackedContainersMutex sync.RWMutex

	ipToContainerID      = make(map[string]string)
	ipToContainerIDMutex sync.RWMutex

	managedNetworks      []ImdsNetwork
	managedNetworksMutex sync.RWMutex

	dockerClient DockerClient
	shutdownChan = make(chan struct{})
)

var findContainerByIPFn = findContainerByIP

// notifyProxyConfigUpdateFn is a variable so tests can replace it with a no-op
// to avoid spawning background goroutines that race with test cleanup.
var notifyProxyConfigUpdateFn = notifyProxyConfigUpdate

func queryProxyContainerState(ctx context.Context, cli DockerClient) ProxyContainerState {
	inspect, err := cli.ContainerInspect(ctx, proxyContainerName)
	if err != nil {
		if cerrdefs.IsNotFound(err) {
			return ProxyStateMissing
		}
		logger.Warnf("Failed to query proxy container state: %v", err)
		return ProxyStateMissing
	}
	if inspect.ContainerJSONBase == nil || inspect.State == nil {
		return ProxyStateMissing
	}
	return containerSummaryStateToProxyState(inspect.State.Status)
}

func containerSummaryStateToProxyState(state string) ProxyContainerState {
	switch state {
	case "running":
		return ProxyStateRunning
	case "paused":
		return ProxyStatePaused
	case "dead":
		return ProxyStateFailed
	default:
		return ProxyStateStopped
	}
}

type DockerClient interface {
	ContainerInspect(ctx context.Context, containerID string) (container.InspectResponse, error)
	ContainerList(ctx context.Context, options container.ListOptions) ([]container.Summary, error)
	Events(ctx context.Context, options events.ListOptions) (<-chan events.Message, <-chan error)
	NetworkConnect(ctx context.Context, networkID, containerID string, config *network.EndpointSettings) error
	NetworkList(ctx context.Context, options network.ListOptions) ([]network.Summary, error)
	ContainerPause(ctx context.Context, containerID string) error
	ContainerUnpause(ctx context.Context, containerID string) error
	Close() error
}

var newDockerClient = func() (DockerClient, error) {
	return client.NewClientWithOpts(client.WithHost("unix:///var/run/docker.sock"), client.WithAPIVersionNegotiation())
}

func main() {
	var socketPath string
	flag.StringVar(&socketPath, "socket", "/run/guest-services/backend.sock", "Unix domain socket to listen on")
	flag.Parse()

	_ = os.RemoveAll(socketPath)

	logger.SetOutput(os.Stdout)

	// Initialize Docker client once at startup
	cli, err := newDockerClient()
	if err != nil {
		logger.Fatalf("Failed to create Docker client: %v", err)
	}
	dockerClient = cli
	defer dockerClient.Close()

	logMiddleware := middleware.LoggerWithConfig(middleware.LoggerConfig{
		Skipper: func(c echo.Context) bool {
			// Skip logging UI polling requests
			if c.Request().Method == http.MethodGet {
				path := c.Path()
				return path == "/settings" || path == "/containers"
			}
			return false
		},
		Format: `{"time":"${time_rfc3339_nano}","id":"${id}",` +
			`"method":"${method}","uri":"${uri}",` +
			`"status":${status},"error":"${error}"` +
			`}` + "\n",
		CustomTimeFormat: "2006-01-02 15:04:05.00000",
		Output:           logger.Writer(),
	})

	logger.Infof("Starting listening on %s\n", socketPath)
	router := echo.New()
	router.HideBanner = true
	router.Use(logMiddleware)
	startURL := ""

	// Load settings from disk
	if err := loadSettings(); err != nil {
		logger.Warnf("Failed to load settings from disk: %v", err)
	}

	// Start monitoring Docker events
	go monitorDockerEvents()

	// Start proxy socket server for container IP lookups
	go startProxySocketServer(proxySocketPath)

	ln, err := listen(socketPath)
	if err != nil {
		logger.Fatal(err)
	}
	router.Listener = ln

	router.GET("/hello", hello)
	router.GET("/settings", getSettings)
	router.POST("/settings", saveSettings)
	router.GET("/proxy-compose", getProxyCompose)
	router.GET("/containers", getContainers)
	router.GET("/compose-project-name", getComposeProjectName)

	logger.Fatal(router.Start(startURL))
}

func startProxySocketServer(socketPath string) {
	_ = os.RemoveAll(socketPath)

	ln, err := listen(socketPath)
	if err != nil {
		logger.Errorf("Failed to listen on proxy socket %s: %v", socketPath, err)
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/container-by-ip", handleContainerLookupByIP)
	mux.HandleFunc("/settings", handleProxyGetSettings)

	server := &http.Server{
		Handler: mux,
	}

	logger.Infof("Proxy socket listening on %s", socketPath)
	if err := server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Errorf("Proxy socket server error: %v", err)
	}
}

func listen(path string) (net.Listener, error) {
	return net.Listen("unix", path)
}

func getLocalIP() (string, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return "", err
	}

	addrs, err := net.LookupIP(hostname)
	if err != nil {
		return "", err
	}

	for _, addr := range addrs {
		if addr.To4() != nil && !addr.IsLoopback() {
			return addr.String(), nil
		}
	}

	return "", errors.New("no IPv4 address found")
}

func updateIPIndex(containerID string) {
	ipToContainerIDMutex.Lock()
	defer ipToContainerIDMutex.Unlock()

	trackedContainersMutex.RLock()
	defer trackedContainersMutex.RUnlock()

	ctr := trackedContainers[containerID]
	for _, network := range ctr.Networks {
		if network.NetworkName != "" {
			if ns, ok := trackedContainers[containerID]; ok {
				for _, net := range ns.Networks {
					if net.NetworkName == network.NetworkName {
						ipToContainerID[network.NetworkID] = containerID
					}
				}
			}
		}
	}
}

func removeIPIndexForContainer(containerID string, containerInfo ContainerInfo) {
	ipToContainerIDMutex.Lock()
	defer ipToContainerIDMutex.Unlock()

	for _, network := range containerInfo.Networks {
		if network.NetworkID != "" {
			if ipToContainerID[network.NetworkID] == containerID {
				delete(ipToContainerID, network.NetworkID)
			}
		}
	}
}

func shortID(containerID string) string {
	if len(containerID) > 12 {
		return containerID[:12]
	}
	return containerID
}

func hello(ctx echo.Context) error {
	ip, err := getLocalIP()
	if err != nil {
		ip = "unknown"
	}
	return ctx.JSON(http.StatusOK, HTTPMessageBody{Message: ip})
}

type HTTPMessageBody struct {
	Message string
}

func getSettings(ctx echo.Context) error {
	settingsMutex.RLock()
	defer settingsMutex.RUnlock()
	return ctx.JSON(http.StatusOK, settings)
}

func saveSettings(ctx echo.Context) error {
	var newSettings Settings
	if err := ctx.Bind(&newSettings); err != nil {
		logger.Warnf("Invalid settings payload: %v", err)
		return ctx.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if newSettings.URL == "" {
		return ctx.JSON(http.StatusBadRequest, map[string]string{"error": "url is required"})
	}

	settingsMutex.Lock()
	settings = newSettings
	settingsMutex.Unlock()

	// Persist settings to disk
	if err := persistSettings(); err != nil {
		logger.Errorf("Failed to persist settings to disk: %v", err)
		return ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to save settings"})
	}

	// Notify proxy of config update
	go notifyProxyConfigUpdateFn()

	logger.Infof("Settings saved: url=%s", newSettings.URL)
	return ctx.JSON(http.StatusOK, map[string]string{"message": "Settings saved successfully"})
}

func getProxyCompose(ctx echo.Context) error {
	data, err := os.ReadFile(proxyComposePath)
	if err != nil {
		logger.Errorf("Failed to read proxy compose file: %v", err)
		return ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read proxy compose file"})
	}

	return ctx.Blob(http.StatusOK, "text/yaml", data)
}

func loadSettings() error {
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			logger.Infof("Settings file does not exist, starting with empty settings")
			return nil
		}
		return err
	}

	var loadedSettings Settings
	if err := json.Unmarshal(data, &loadedSettings); err != nil {
		return err
	}

	settingsMutex.Lock()
	settings = loadedSettings
	logURL := settings.URL
	settingsMutex.Unlock()

	logger.Infof("Settings loaded from disk: url=%s", logURL)
	return nil
}

func handleProxyGetSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	settingsMutex.RLock()
	currentSettings := settings
	settingsMutex.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(currentSettings); err != nil {
		logger.Errorf("Failed to encode settings response: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
}

func handleContainerLookupByIP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var request ProxyLookupRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		logger.Warnf("Invalid proxy lookup payload: %v", err)
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if request.IP == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	response, err := findContainerByIPFn(ctx, dockerClient, request.IP)
	if err != nil {
		logger.Errorf("Failed to lookup container for IP %s: %v", request.IP, err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	if response == nil {
		logger.Infof("No container found for IP %s", request.IP)
		w.WriteHeader(http.StatusNotFound)
		return
	}

	logger.Infof("Container lookup for IP %s: id=%s name=%s", request.IP, response.ContainerID, response.Name)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		logger.Errorf("Failed to encode lookup response: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
}

func findContainerByIP(ctx context.Context, cli DockerClient, ip string) (*ProxyLookupResponse, error) {
	trackedContainersMutex.RLock()
	defer trackedContainersMutex.RUnlock()

	for _, ctr := range trackedContainers {
		for _, network := range ctr.Networks {
			if network.NetworkName != "" {
				ns, ok := trackedContainers[ctr.ContainerID]
				if ok {
					for _, net := range ns.Networks {
						if net.NetworkName != "" {
							inspect, err := cli.ContainerInspect(ctx, ctr.ContainerID)
							if err != nil {
								continue
							}

							if inspect.NetworkSettings == nil {
								continue
							}

							if settings, ok := inspect.NetworkSettings.Networks[net.NetworkName]; ok {
								if settings.IPAddress == ip || settings.GlobalIPv6Address == ip {
									return &ProxyLookupResponse{
										ContainerID: ctr.ContainerID,
										Name:        ctr.Name,
										Labels:      ctr.Labels,
									}, nil
								}
							}
						}
					}
				}
			}
		}
	}

	return nil, nil
}

func persistSettings() error {
	// Ensure settings directory exists
	if err := os.MkdirAll(filepath.Dir(settingsPath), 0755); err != nil {
		return err
	}

	settingsMutex.RLock()
	currentSettings := settings
	settingsMutex.RUnlock()

	data, err := json.MarshalIndent(currentSettings, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(settingsPath, data, 0644); err != nil {
		return err
	}

	logger.Debugf("Settings persisted to %s", settingsPath)
	return nil
}

func monitorDockerEvents() {
	ctx := context.Background()

	logger.Infof("Started monitoring Docker container events")

	// Discover managed IMDS networks
	if err := discoverManagedNetworks(ctx, dockerClient); err != nil {
		logger.Errorf("Failed to discover managed networks: %v", err)
	}

	// Scan existing containers
	if err := scanExistingContainers(ctx, dockerClient); err != nil {
		logger.Errorf("Failed to scan existing containers: %v", err)
	}

	eventsChan, errChan := dockerClient.Events(ctx, events.ListOptions{})

	for {
		select {
		case <-shutdownChan:
			logger.Infof("Shutting down Docker event monitoring")
			return
		case event := <-eventsChan:
			if event.Type == events.ContainerEventType {
				switch event.Action {
				case "create":
					logger.Infof("Container created: %s (image: %s)", shortID(event.Actor.ID), event.Actor.Attributes["image"])
					// Check if container has the enabled label
					if event.Actor.Attributes["imds-proxy.enabled"] == "true" {
						if err := addContainerToTrackingWithNetwork(ctx, dockerClient, event.Actor.ID, true); err != nil {
							logger.Errorf("Failed to add container to tracking: %v", err)
						}
					}
				case "destroy":
					logger.Infof("Container destroyed: %s", shortID(event.Actor.ID))
					removeContainerFromTracking(event.Actor.ID)
					// Notify proxy to clear cache for this container
					go notifyProxyContainerDestroyed(event.Actor.ID)
				}
			} else if event.Type == events.NetworkEventType {
				switch event.Action {
				case "connect", "disconnect":
					containerID := event.Actor.Attributes["container"]
					if containerID != "" {
						trackedContainersMutex.RLock()
						_, tracked := trackedContainers[containerID]
						trackedContainersMutex.RUnlock()
						if tracked {
							if err := refreshContainerNetworks(ctx, dockerClient, containerID); err != nil {
								logger.Errorf("Failed to refresh networks for container %s: %v", shortID(containerID), err)
							}
						}
					}
				}
			}
		case err := <-errChan:
			if err != nil && err != io.EOF {
				logger.Errorf("Error monitoring Docker events: %v", err)
			}
			return
		}
	}
}

func scanExistingContainers(ctx context.Context, cli DockerClient) error {
	containers, err := cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return err
	}
	logger.Infof("Found %d existing containers. Now scanning for imds-proxy.enabled=true label", len(containers))

	for _, ctr := range containers {
		if ctr.Labels != nil && ctr.Labels["imds-proxy.enabled"] == "true" {
			if err := addContainerToTrackingWithNetwork(ctx, cli, ctr.ID, false); err != nil {
				logger.Errorf("Failed to add existing container to tracking: %v", err)
			}
		}
	}

	logger.Infof("Scanned existing containers, found %d with imds-proxy.enabled=true", len(trackedContainers))
	return nil
}

func addContainerToTrackingWithNetwork(ctx context.Context, cli DockerClient, containerID string, pauseFirst bool) error {
	inspect, err := cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return err
	}

	// Check which IMDS networks the container is already connected to
	connectedNetworks := make(map[string]bool)
	for networkName := range inspect.NetworkSettings.Networks {
		connectedNetworks[networkName] = true
	}

	// Determine which networks need to be connected
	managedNetworksMutex.RLock()
	knownNetworks := managedNetworks
	managedNetworksMutex.RUnlock()

	networksToConnect := []string{}
	for _, mn := range knownNetworks {
		if !connectedNetworks[mn.NetworkName] {
			networksToConnect = append(networksToConnect, mn.NetworkName)
		}
	}

	// Connect to IMDS networks if needed
	if len(networksToConnect) > 0 {
		paused := false
		if pauseFirst && inspect.State.Running {
			logger.Infof("Pausing container %s before connecting to networks", shortID(containerID))
			if err := cli.ContainerPause(ctx, containerID); err != nil {
				logger.Errorf("Failed to pause container %s: %v", shortID(containerID), err)
				// Continue anyway
			} else {
				paused = true
			}
			defer func() {
				if paused {
					logger.Infof("Unpausing container %s after connecting to networks", shortID(containerID))
					if err := cli.ContainerUnpause(ctx, containerID); err != nil {
						logger.Errorf("Failed to unpause container %s: %v", shortID(containerID), err)
					}
				}
			}()
		}

		for _, networkName := range networksToConnect {
			logger.Infof("Connecting container %s to network %s", shortID(containerID), networkName)
			if err := cli.NetworkConnect(ctx, networkName, containerID, &network.EndpointSettings{}); err != nil {
				logger.Errorf("Failed to connect container %s to network %s: %v", shortID(containerID), networkName, err)
				// Continue tracking even if network connection fails
			}
		}
	}

	// Re-inspect to get updated network information
	inspect, err = cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return err
	}

	networks := make([]NetworkInfo, 0)
	for networkName, networkSettings := range inspect.NetworkSettings.Networks {
		networks = append(networks, NetworkInfo{
			NetworkID:   networkSettings.NetworkID,
			NetworkName: networkName,
		})
	}

	containerInfo := ContainerInfo{
		ContainerID: inspect.ID,
		Name:        inspect.Name,
		Labels:      inspect.Config.Labels,
		Networks:    networks,
	}

	if containerInfo.Labels == nil {
		containerInfo.Labels = make(map[string]string)
	}

	trackedContainersMutex.Lock()
	trackedContainers[containerID] = containerInfo
	trackedContainersMutex.Unlock()

	updateIPIndex(containerID)

	logger.Infof("Added container to tracking: %s (%s)", shortID(containerID), inspect.Name)
	return nil
}

func removeContainerFromTracking(containerID string) {
	trackedContainersMutex.Lock()
	info, exists := trackedContainers[containerID]
	if exists {
		delete(trackedContainers, containerID)
	}
	trackedContainersMutex.Unlock()

	if exists {
		removeIPIndexForContainer(containerID, info)
		logger.Infof("Removed container from tracking: %s (%s)", shortID(containerID), info.Name)
	}
}

func refreshContainerNetworks(ctx context.Context, cli DockerClient, containerID string) error {
	inspect, err := cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return err
	}

	networks := make([]NetworkInfo, 0)
	for networkName, networkSettings := range inspect.NetworkSettings.Networks {
		networks = append(networks, NetworkInfo{
			NetworkID:   networkSettings.NetworkID,
			NetworkName: networkName,
		})
	}

	trackedContainersMutex.Lock()
	info, exists := trackedContainers[containerID]
	if exists {
		info.Networks = networks
		trackedContainers[containerID] = info
	}
	trackedContainersMutex.Unlock()

	if exists {
		updateIPIndex(containerID)
		logger.Infof("Refreshed networks for container %s", shortID(containerID))
	}

	return nil
}

// parseProviderLabel parses the imds-proxy.providers label value into a map
// of provider name to the protocols it carries on that network.
// Format: "AWS=v4,v6;GCP=v4,v6;OpenStack=v4"
func parseProviderLabel(s string) map[string][]string {
	result := make(map[string][]string)
	for _, entry := range strings.Split(s, ";") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		protos := []string{}
		for _, p := range strings.Split(parts[1], ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				protos = append(protos, p)
			}
		}
		if name != "" {
			result[name] = protos
		}
	}
	return result
}

// buildProviderStatuses aggregates per-provider connectivity across all managed
// networks, given the set of networks the container is currently connected to.
func buildProviderStatuses(containerNetworks []NetworkInfo, managedNets []ImdsNetwork) []ProviderStatus {
	connectedNames := make(map[string]bool, len(containerNetworks))
	for _, n := range containerNetworks {
		connectedNames[n.NetworkName] = true
	}

	// Collect which protocols are connected per provider
	connectedProtos := make(map[string]map[string]bool)
	// Track all known provider names (to include disconnected ones)
	allProviders := make(map[string]bool)

	for _, mn := range managedNets {
		connected := connectedNames[mn.NetworkName]
		for provider, protos := range mn.Providers {
			allProviders[provider] = true
			if connected {
				if connectedProtos[provider] == nil {
					connectedProtos[provider] = make(map[string]bool)
				}
				for _, proto := range protos {
					connectedProtos[provider][proto] = true
				}
			}
		}
	}

	names := make([]string, 0, len(allProviders))
	for name := range allProviders {
		names = append(names, name)
	}
	sort.Strings(names)

	statuses := make([]ProviderStatus, 0, len(names))
	for _, name := range names {
		statuses = append(statuses, ProviderStatus{
			Name:          name,
			IPv4Connected: connectedProtos[name]["v4"],
			IPv6Connected: connectedProtos[name]["v6"],
		})
	}
	return statuses
}

func discoverManagedNetworks(ctx context.Context, cli DockerClient) error {
	networkList, err := cli.NetworkList(ctx, network.ListOptions{
		Filters: filters.NewArgs(filters.Arg("label", imdsManagedLabel+"=true")),
	})
	if err != nil {
		return err
	}

	discovered := make([]ImdsNetwork, 0, len(networkList))
	for _, n := range networkList {
		discovered = append(discovered, ImdsNetwork{
			NetworkName: n.Name,
			Providers:   parseProviderLabel(n.Labels[imdsProvidersLabel]),
		})
	}

	managedNetworksMutex.Lock()
	managedNetworks = discovered
	managedNetworksMutex.Unlock()

	logger.Infof("Discovered %d managed IMDS network(s)", len(discovered))
	return nil
}

func getContainers(ctx echo.Context) error {
	trackedContainersMutex.RLock()
	defer trackedContainersMutex.RUnlock()

	managedNetworksMutex.RLock()
	networks := managedNetworks
	managedNetworksMutex.RUnlock()

	containerList := make([]ContainerInfo, 0, len(trackedContainers))
	for _, info := range trackedContainers {
		info.Providers = buildProviderStatuses(info.Networks, networks)
		containerList = append(containerList, info)
	}

	queryCtx, cancel := context.WithTimeout(ctx.Request().Context(), 3*time.Second)
	defer cancel()
	proxyStatus := queryProxyContainerState(queryCtx, dockerClient)

	return ctx.JSON(http.StatusOK, ContainersAPIResponse{
		Containers:  containerList,
		ProxyStatus: proxyStatus,
	})
}

func getComposeProjectName(ctx echo.Context) error {
	hostname, err := os.Hostname()
	if err != nil {
		logger.Errorf("Failed to get hostname: %v", err)
		return ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get hostname"})
	}

	queryCtx, cancel := context.WithTimeout(ctx.Request().Context(), 3*time.Second)
	defer cancel()

	inspect, err := dockerClient.ContainerInspect(queryCtx, hostname)
	if err != nil {
		logger.Errorf("Failed to inspect container %s: %v", hostname, err)
		return ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to inspect container"})
	}

	projectName := ""
	configFiles := ""
	if inspect.Config != nil && inspect.Config.Labels != nil {
		projectName = inspect.Config.Labels["com.docker.compose.project"]
		configFiles = inspect.Config.Labels["com.docker.compose.project.config_files"]
	}

	if projectName == "" {
		logger.Warnf("No com.docker.compose.project label found on container %s", hostname)
		return ctx.JSON(http.StatusNotFound, map[string]string{"error": "Compose project name not found"})
	}

	return ctx.JSON(http.StatusOK, map[string]string{"projectName": projectName, "configFiles": configFiles})
}

func notifyProxyConfigUpdate() {
	maxRetries := 3
	backoff := 100 * time.Millisecond
	socketPath := proxyNotificationSocketPath

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff)
			backoff *= 2
		}

		client := &http.Client{
			Transport: &http.Transport{
				DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
					return net.Dial("unix", socketPath)
				},
			},
			Timeout: 5 * time.Second,
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://unix/config-updated", nil)
		if err != nil {
			logger.Errorf("Failed to create proxy notification request: %v", err)
			return
		}

		resp, err := client.Do(req)
		if err != nil {
			logger.Warnf("Attempt %d/%d: Failed to notify proxy of config update: %v", attempt+1, maxRetries, err)
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			logger.Warnf("Attempt %d/%d: Proxy notification returned status %d", attempt+1, maxRetries, resp.StatusCode)
			continue
		}

		logger.Infof("Proxy notified of configuration update")
		return
	}

	logger.Errorf("Failed to notify proxy of config update after %d attempts", maxRetries)
}

func notifyProxyContainerDestroyed(containerID string) {
	maxRetries := 3
	backoff := 100 * time.Millisecond
	socketPath := proxyNotificationSocketPath

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff)
			backoff *= 2
		}

		client := &http.Client{
			Transport: &http.Transport{
				DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
					return net.Dial("unix", socketPath)
				},
			},
			Timeout: 5 * time.Second,
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)

		payload := map[string]string{"containerId": containerID}
		body, err := json.Marshal(payload)
		if err != nil {
			cancel()
			logger.Errorf("Failed to marshal container destroyed payload: %v", err)
			return
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://unix/container-destroyed", bytes.NewReader(body))
		if err != nil {
			cancel()
			logger.Errorf("Failed to create proxy container destroyed notification request: %v", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		cancel()

		if err != nil {
			logger.Warnf("Attempt %d/%d: Failed to notify proxy of container destruction: %v", attempt+1, maxRetries, err)
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			logger.Warnf("Attempt %d/%d: Proxy container destroyed notification returned status %d", attempt+1, maxRetries, resp.StatusCode)
			continue
		}

		logger.Infof("Proxy notified of container %s destruction", shortID(containerID))
		return
	}

	logger.Errorf("Failed to notify proxy of container %s destruction after %d attempts", shortID(containerID), maxRetries)
}
