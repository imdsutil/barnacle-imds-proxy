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

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDockerDesktopService } from '../services/dockerDesktopService';

describe('Docker Desktop Service', () => {
  it('should create a service with getSettings and getContainers methods', () => {
    const mockClient = {
      extension: {
        vm: {
          service: {
            get: vi.fn(),
          },
        },
      },
    };

    const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
    const service = result.current;

    expect(service).toHaveProperty('getSettings');
    expect(service).toHaveProperty('getContainers');
    expect(typeof service.getSettings).toBe('function');
    expect(typeof service.getContainers).toBe('function');
  });

  it('should call service.get with correct path for getSettings', async () => {
    const mockGet = vi.fn().mockResolvedValue({ url: 'http://localhost:8080' });
    const mockClient = {
      extension: {
        vm: {
          service: {
            get: mockGet,
          },
        },
      },
    };

    const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
    await result.current.getSettings();

    expect(mockGet).toHaveBeenCalledWith('/settings');
  });

  it('should call service.get with correct path for getContainers', async () => {
    const mockGet = vi.fn().mockResolvedValue([]);
    const mockClient = {
      extension: {
        vm: {
          service: {
            get: mockGet,
          },
        },
      },
    };

    const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
    await result.current.getContainers();

    expect(mockGet).toHaveBeenCalledWith('/containers');
  });

  it('should throw error when client is not available', async () => {
    const { result } = renderHook(() => useDockerDesktopService(null));

    await expect(result.current.getSettings()).rejects.toThrow('Docker Desktop client not available');
    await expect(result.current.getContainers()).rejects.toThrow('Docker Desktop client not available');
  });

  it('should propagate errors from underlying service calls', async () => {
    const mockError = new Error('Service error');
    const mockGet = vi.fn().mockRejectedValue(mockError);
    const mockClient = {
      extension: {
        vm: {
          service: {
            get: mockGet,
          },
        },
      },
    };

    const { result } = renderHook(() => useDockerDesktopService(mockClient as any));

    await expect(result.current.getSettings()).rejects.toThrow('Service error');
  });

  describe('Edge Cases', () => {
    it('should handle empty containers array', async () => {
      const mockGet = vi.fn().mockResolvedValue([]);
      const mockClient = {
        extension: {
          vm: {
            service: {
              get: mockGet,
            },
          },
        },
      };

      const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
      const containers = await result.current.getContainers();

      expect(containers).toEqual([]);
    });

    it('should handle null response from backend', async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      const mockClient = {
        extension: {
          vm: {
            service: {
              get: mockGet,
            },
          },
        },
      };

      const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
      const response = await result.current.getSettings();

      expect(response).toBeNull();
    });

    it('should handle Unicode in container names', async () => {
      const unicodeContainers = [
        {
          containerId: 'abc123',
          name: '/🐳-docker-container',
          labels: {},
          networks: [],
        },
        {
          containerId: 'def456',
          name: '/容器-测试',
          labels: {},
          networks: [],
        },
        {
          containerId: 'ghi789',
          name: '/test-🚀-подтест-测试',
          labels: {},
          networks: [],
        },
      ];

      const mockGet = vi.fn().mockResolvedValue(unicodeContainers);
      const mockClient = {
        extension: {
          vm: {
            service: {
              get: mockGet,
            },
          },
        },
      };

      const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
      const containers = await result.current.getContainers();

      expect(containers).toEqual(unicodeContainers);
      expect(containers[0].name).toBe('/🐳-docker-container');
      expect(containers[1].name).toBe('/容器-测试');
      expect(containers[2].name).toBe('/test-🚀-подтест-测试');
    });

    it('should handle very long container IDs', async () => {
      const longId = 'a'.repeat(512);
      const mockGet = vi.fn().mockResolvedValue([
        {
          containerId: longId,
          name: '/test-long-id',
          labels: {},
          networks: [],
        },
      ]);
      const mockClient = {
        extension: {
          vm: {
            service: {
              get: mockGet,
            },
          },
        },
      };

      const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
      const containers = await result.current.getContainers();

      expect(containers[0].containerId).toBe(longId);
      expect(containers[0].containerId.length).toBe(512);
    });

    it('should handle containers with missing optional fields', async () => {
      const sparseContainers = [
        {
          containerId: 'abc123',
          name: '/test',
          // labels and networks might be missing in edge cases
        },
      ];

      const mockGet = vi.fn().mockResolvedValue(sparseContainers);
      const mockClient = {
        extension: {
          vm: {
            service: {
              get: mockGet,
            },
          },
        },
      };

      const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
      const containers = await result.current.getContainers();

      expect(containers).toEqual(sparseContainers);
      expect(containers[0].containerId).toBe('abc123');
    });

    it('should handle empty string values in container data', async () => {
      const emptyStringContainers = [
        {
          containerId: '',
          name: '',
          labels: {},
          networks: [],
        },
      ];

      const mockGet = vi.fn().mockResolvedValue(emptyStringContainers);
      const mockClient = {
        extension: {
          vm: {
            service: {
              get: mockGet,
            },
          },
        },
      };

      const { result } = renderHook(() => useDockerDesktopService(mockClient as any));
      const containers = await result.current.getContainers();

      expect(containers).toEqual(emptyStringContainers);
      expect(containers[0].containerId).toBe('');
      expect(containers[0].name).toBe('');
    });
  });
});
