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

import { describe, it, expect } from 'vitest';
import { isSettingsResponse, isContainersResponse } from '../types';
import {
  createMockContainer,
  TEST_SETTINGS_URL,
  TEST_CONTAINER_ID,
} from './testHelpers';

describe('Type Guards', () => {
  describe('isSettingsResponse', () => {
    it('should return true for valid settings object', () => {
      const settings = { url: TEST_SETTINGS_URL };
      expect(isSettingsResponse(settings)).toBe(true);
    });

    it('should return true for settings with missing url', () => {
      const settings = {};
      expect(isSettingsResponse(settings)).toBe(true);
    });

    it('should return false for non-object values', () => {
      expect(isSettingsResponse('string')).toBe(false);
      expect(isSettingsResponse(null)).toBe(false);
      expect(isSettingsResponse(undefined)).toBe(false);
      expect(isSettingsResponse(123)).toBe(false);
    });

    it('should return false for arrays', () => {
      expect(isSettingsResponse([])).toBe(false);
    });
  });

  describe('isContainersResponse', () => {
    it('should return true for valid containers array', () => {
      const containers = [
        createMockContainer({
          containerId: TEST_CONTAINER_ID,
          name: '/my-container',
          labels: { key: 'value' },
        }),
      ];
      expect(isContainersResponse(containers)).toBe(true);
    });

    it('should return true for empty containers array', () => {
      expect(isContainersResponse([])).toBe(true);
    });

    it('should return false for non-array values', () => {
      expect(isContainersResponse('string')).toBe(false);
      expect(isContainersResponse(null)).toBe(false);
      expect(isContainersResponse(undefined)).toBe(false);
      expect(isContainersResponse({ data: [] })).toBe(false);
    });

    it('should return false for invalid container objects', () => {
      const invalidContainers = [
        {
          // Missing required fields
          containerId: TEST_CONTAINER_ID,
        },
      ];
      expect(isContainersResponse(invalidContainers)).toBe(false);
    });

    it('should return false if imdsNetworks is not an array', () => {
      const invalidContainers = [
        {
          containerId: TEST_CONTAINER_ID,
          name: '/my-container',
          labels: {},
          imdsNetworks: 'not-an-array',
        },
      ];
      expect(isContainersResponse(invalidContainers)).toBe(false);
    });
  });
});
