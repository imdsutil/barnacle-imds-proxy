/**
 * Copyright 2026 Matt Miller
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Docker Desktop service abstraction layer
 * Centralizes VM service API calls for easier testing and mocking
 */

import { useMemo } from 'react';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import type { ContainerInfo, SettingsResponse } from '../types';

export interface DockerDesktopServiceClient {
  getSettings: () => Promise<SettingsResponse>;
  getContainers: () => Promise<ContainerInfo[]>;
}

export function useDockerDesktopService(ddClient: ReturnType<typeof createDockerDesktopClient> | null): DockerDesktopServiceClient {
  return useMemo(() => ({
    getSettings: async () => {
      if (!ddClient) {
        throw new Error('Docker Desktop client not available');
      }
      return ddClient.extension.vm?.service?.get('/settings') as Promise<SettingsResponse>;
    },
    getContainers: async () => {
      if (!ddClient) {
        throw new Error('Docker Desktop client not available');
      }
      return ddClient.extension.vm?.service?.get('/containers') as Promise<ContainerInfo[]>;
    },
  }), [ddClient]);
}
