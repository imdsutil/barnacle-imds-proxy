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

import { AddressStatus, DisplayContainer, isContainerInfo } from '../types';

/**
 * Coerce raw container entries into rows the table can render
 * A bad element keeps its place in the list with per-field fallbacks and a
 * malformed flag, so it stays visible instead of throwing or being dropped
 *
 * @param values - The raw container entries from the backend
 * @returns One row per entry, flagged when the entry was not valid
 */
export const toDisplayContainers = (values: unknown[]): DisplayContainer[] => {
  return values.map((value) => {
    if (isContainerInfo(value)) {
      return value;
    }
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    return {
      containerId: typeof raw.containerId === 'string' ? raw.containerId : 'unknown',
      name: typeof raw.name === 'string' ? raw.name : 'unknown',
      labels: typeof raw.labels === 'object' && raw.labels !== null
        ? (raw.labels as Record<string, string>)
        : {},
      addresses: Array.isArray(raw.addresses) ? (raw.addresses as AddressStatus[]) : [],
      malformed: true,
    };
  });
};

/**
 * Remove leading slash from Docker container names
 * Docker returns container names with a leading "/" but we display them without it
 *
 * @param name - The container name, potentially with leading slash
 * @returns The container name without leading slash
 */
export const cleanContainerName = (name: string): string => {
  return name.startsWith('/') ? name.substring(1) : name;
};
