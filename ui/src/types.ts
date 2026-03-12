// Copyright 2026 Matt Miller

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

// [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Network information for a container
 */
export interface NetworkInfo {
  networkId: string;
  networkName: string;
}

/**
 * Container information from Docker Desktop
 */
export interface ContainerInfo {
  containerId: string;
  name: string;
  labels: Record<string, string>;
  networks: NetworkInfo[];
}

/**
 * Settings response from backend
 */
export interface SettingsResponse {
  url?: string;
}

/**
 * Type guard to validate settings response
 */
export const isSettingsResponse = (value: unknown): value is SettingsResponse => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Type guard to validate containers response
 */
export const isContainersResponse = (value: unknown): value is ContainerInfo[] => {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((item) =>
    typeof item === 'object' &&
    item !== null &&
    typeof (item as ContainerInfo).containerId === 'string' &&
    typeof (item as ContainerInfo).name === 'string' &&
    typeof (item as ContainerInfo).labels === 'object' &&
    Array.isArray((item as ContainerInfo).networks)
  );
};
