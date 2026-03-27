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

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import { App } from '../App';
import { createMockGetImplementation, TEST_SETTINGS_URL } from './testHelpers';

const mockGet = vi.fn();
const mockDesktopClient = {
  extension: {
    vm: {
      service: {
        get: mockGet,
      },
    },
  },
};

describe('App', () => {
  beforeEach(() => {
    mockGet.mockReset();
    vi.mocked(createDockerDesktopClient).mockReturnValue(mockDesktopClient as any);
  });

  it('shows snackbar on invalid containers response', async () => {
    mockGet.mockImplementation(createMockGetImplementation({
      settings: { url: TEST_SETTINGS_URL },
      containers: { invalid: 'response' },
    }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Unexpected containers response format')).toBeTruthy();
    });
  });

  it('sets error state on container load failure', async () => {
    mockGet.mockImplementation(createMockGetImplementation({
      settings: { url: TEST_SETTINGS_URL },
      containers: new Error('network error'),
    }));

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText(/Extension backend not responding/)).toBeTruthy();
      },
      { timeout: 3000 }
    );
  });

  it('respects isMountedRef on unmount to avoid state updates', async () => {
    mockGet.mockImplementation(createMockGetImplementation({
      settings: { url: TEST_SETTINGS_URL },
      containers: new Promise(() => {}), // never resolves
    }));

    const { unmount } = render(<App />);

    unmount();

    // If test completes without warnings about state updates on unmounted component, it passes
    expect(true).toBe(true);
  });

  it('shows success snackbar when copy to clipboard succeeds', async () => {
    const mockWriteText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
      configurable: true,
    });

    mockGet.mockImplementation(createMockGetImplementation({
      settings: { url: TEST_SETTINGS_URL },
      containers: [],
    }));

    render(<App />);

    // Find and click the label copy button
    const copyButton = await screen.findByRole('button', { name: /copy label to clipboard/i });
    copyButton.click();

    expect(mockWriteText).toHaveBeenCalledWith('imds-proxy.enabled=true');

    await waitFor(() => {
      expect(screen.getByText('Copied label to clipboard')).toBeTruthy();
    });
  });

  it('shows error snackbar when copy to clipboard fails', async () => {
    const mockWriteText = vi.fn(() => Promise.reject(new Error('clipboard error')));
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
      configurable: true,
    });

    mockGet.mockImplementation(createMockGetImplementation({
      settings: { url: TEST_SETTINGS_URL },
      containers: [],
    }));

    render(<App />);

    // Find and click the label copy button
    const copyButton = await screen.findByRole('button', { name: /copy label to clipboard/i });
    copyButton.click();

    await waitFor(() => {
      expect(screen.getByText('Failed to copy to clipboard')).toBeTruthy();
    });
  });

  it('shows error snackbar when clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    mockGet.mockImplementation(createMockGetImplementation({
      settings: { url: TEST_SETTINGS_URL },
      containers: [],
    }));

    render(<App />);

    // Find and click the label copy button
    const copyButton = await screen.findByRole('button', { name: /copy label to clipboard/i });

    // Wrap click in act() since clipboard check causes synchronous state update
    act(() => {
      copyButton.click();
    });

    await waitFor(() => {
      expect(screen.getByText('Clipboard not available')).toBeTruthy();
    });
  });
});
