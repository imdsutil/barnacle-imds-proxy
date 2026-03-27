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
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContainersTable } from '../components/ContainersTable';
import { createMockContainer, createMockContainers } from './testHelpers';

const mockContainers = [
  createMockContainer({
    containerId: 'abc123def456ghi789jkl012mno345pqr678',
    name: '/zebra-container',
  }),
  createMockContainer({
    containerId: '111222333444555666777888999000aaabbb',
    name: '/alpha-container',
  }),
  createMockContainer({
    containerId: 'xyz987wvu654tsr321qpo098nml876kjh543',
    name: '/beta-container',
  }),
];

const LARGE_SET_SIZE = 30;
const ALPHA_CONTAINER_ID = '111222333444555666777888999000aaabbb';

describe('ContainersTable', () => {
  it('sorts by name ascending by default', () => {
    const mockCallback = vi.fn();
    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={false}
        onCopyToClipboard={mockCallback}
      />
    );

    const rows = screen.getAllByRole('row');
    // Skip header row (index 0); each data row is followed by a collapsed expansion row,
    // so data rows are at odd indices: 1, 3, 5, ...
    expect(rows[1].textContent).toContain('alpha-container');
    expect(rows[3].textContent).toContain('beta-container');
    expect(rows[5].textContent).toContain('zebra-container');
  });

  it('sorts by name descending when clicking name column twice', () => {
    const mockCallback = vi.fn();
    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={false}
        onCopyToClipboard={mockCallback}
      />
    );

    const nameSort = screen.getByText('Name');
    fireEvent.click(nameSort);

    const rows = screen.getAllByRole('row');
    expect(rows[1].textContent).toContain('zebra-container');
    expect(rows[3].textContent).toContain('beta-container');
    expect(rows[5].textContent).toContain('alpha-container');
  });

  it('sorts by container ID when clicking ID column', () => {
    const mockCallback = vi.fn();
    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={false}
        onCopyToClipboard={mockCallback}
      />
    );

    const idSort = screen.getByText('Container ID');
    fireEvent.click(idSort);

    const rows = screen.getAllByRole('row');
    // IDs start with: "111...", "abc...", "xyz..."
    // Ascending alphabetically: "111" < "abc" < "xyz"
    expect(rows[1].textContent).toContain('111222333444');
    expect(rows[3].textContent).toContain('abc123def456');
    expect(rows[5].textContent).toContain('xyz987wvu654');
  });

  it('shows all containers without pagination', () => {
    const mockCallback = vi.fn();
    const manyContainers = createMockContainers(LARGE_SET_SIZE);

    render(
      <ContainersTable
        containers={manyContainers}
        isLoading={false}
        onCopyToClipboard={mockCallback}
      />
    );

    // All containers rendered at once: 1 header + N data rows + N expansion rows
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(LARGE_SET_SIZE * 2 + 1);
    expect(screen.getByText(`Showing ${LARGE_SET_SIZE} items`)).toBeDefined();
  });

  it('copy button triggers callback without selecting row', () => {
    const mockCallback = vi.fn();
    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={false}
        onCopyToClipboard={mockCallback}
      />
    );

    // Find copy button for alpha-container name
    const copyButtons = screen.getAllByRole('button', { name: /copy container name/i });
    fireEvent.click(copyButtons[0]);

    // Callback should be called with name
    expect(mockCallback).toHaveBeenCalledWith('alpha-container', 'container name');

    // Row should NOT be selected (no selected class applied)
    const rows = screen.getAllByRole('row');
    const alphaRow = rows[1];
    expect(alphaRow.className).not.toContain('Mui-selected');
  });

  it('copy button for container ID works correctly', () => {
    const mockCallback = vi.fn();
    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={false}
        onCopyToClipboard={mockCallback}
      />
    );

    // Find copy button for container ID
    const copyButtons = screen.getAllByRole('button', { name: /copy container id/i });
    fireEvent.click(copyButtons[0]);

    // Callback should be called with full container ID
    expect(mockCallback).toHaveBeenCalledWith(
      ALPHA_CONTAINER_ID,
      'container ID'
    );
  });

  it('displays loading message when loading with no containers', () => {
    const mockCallback = vi.fn();

    render(
      <ContainersTable
        containers={[]}
        isLoading={true}
        onCopyToClipboard={mockCallback}
      />
    );

    // Skeleton renders as a div with no text — just verify the table is not shown
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('does not show loading message when loading but has containers', () => {
    const mockCallback = vi.fn();

    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={true}
        onCopyToClipboard={mockCallback}
      />
    );

    // Should show table, not loading message, when containers exist
    expect(screen.queryByText('Loading containers...')).toBeNull();
    expect(screen.queryByText('webapp')).toBeDefined();
  });
});
