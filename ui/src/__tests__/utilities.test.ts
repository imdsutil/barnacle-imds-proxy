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
import { cleanContainerName } from '../utils/containerUtils';

describe('Utility Functions', () => {
  describe('cleanContainerName', () => {
    it('should remove leading slash from container name', () => {
      expect(cleanContainerName('/my-container')).toBe('my-container');
    });

    it('should not modify name without leading slash', () => {
      expect(cleanContainerName('my-container')).toBe('my-container');
    });

    it('should handle empty string', () => {
      expect(cleanContainerName('')).toBe('');
    });

    it('should handle only slash', () => {
      expect(cleanContainerName('/')).toBe('');
    });

    it('should handle multiple slashes', () => {
      expect(cleanContainerName('//my-container')).toBe('/my-container');
    });

    it('should handle container names with special characters', () => {
      expect(cleanContainerName('/my_container-123')).toBe('my_container-123');
    });
  });
});
