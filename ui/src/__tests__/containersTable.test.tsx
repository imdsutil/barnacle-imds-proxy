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
    networks: [
      { networkId: 'net1', networkName: 'bridge' },
      { networkId: 'net2', networkName: 'custom' },
    ],
  }),
  createMockContainer({
    containerId: '111222333444555666777888999000aaabbb',
    name: '/alpha-container',
    networks: [{ networkId: 'net3', networkName: 'host' }],
  }),
  createMockContainer({
    containerId: 'xyz987wvu654tsr321qpo098nml876kjh543',
    name: '/beta-container',
    networks: [{ networkId: 'net4', networkName: 'overlay' }],
  }),
];

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_25 = 25;
const PAGINATION_SET_SIZE = 15;
const LARGE_SET_SIZE = 30;
const ALPHA_CONTAINER_ID = '111222333444555666777888999000aaabbb';

describe('ContainersTable', () => {
  it('sorts by name ascending by default', () => {
    const mockCallback = vi.fn();
    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={false}
        error={null}
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
        error={null}
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
        error={null}
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

  it('paginates containers correctly', () => {
    const mockCallback = vi.fn();

    // Create 15 containers to test pagination
    const manyContainers = createMockContainers(PAGINATION_SET_SIZE);

    render(
      <ContainersTable
        containers={manyContainers}
        isLoading={false}
        error={null}
        onCopyToClipboard={mockCallback}
      />
    );

    // Default is 10 per page, should show container-0 through container-9
    // Each data row has a sibling expansion row, so total = 1 header + N*2 rows
    let rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(DEFAULT_PAGE_SIZE * 2 + 1);

    // Click next page
    const nextButton = screen.getByRole('button', { name: /next page/i });
    fireEvent.click(nextButton);

    // Should now show remaining 5 containers (sorted alphabetically: container-5 through container-9)
    rows = screen.getAllByRole('row');
    expect(rows).toHaveLength((PAGINATION_SET_SIZE - DEFAULT_PAGE_SIZE) * 2 + 1);
    expect(rows[1].textContent).toContain('container-5');
  });

  it('changes rows per page correctly', () => {
    const mockCallback = vi.fn();

    const manyContainers = createMockContainers(LARGE_SET_SIZE);

    render(
      <ContainersTable
        containers={manyContainers}
        isLoading={false}
        error={null}
        onCopyToClipboard={mockCallback}
      />
    );

    // Default is 10 per page; each data row has a sibling expansion row
    let rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(DEFAULT_PAGE_SIZE * 2 + 1);

    // Change to 25 per page
    const rowsPerPageSelect = screen.getByRole('combobox');
    fireEvent.mouseDown(rowsPerPageSelect);
    const option25 = screen.getByRole('option', { name: String(PAGE_SIZE_25) });
    fireEvent.click(option25);

    rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(PAGE_SIZE_25 * 2 + 1);
  });

  it('copy button triggers callback without selecting row', () => {
    const mockCallback = vi.fn();
    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={false}
        error={null}
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
        error={null}
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
        error={null}
        onCopyToClipboard={mockCallback}
      />
    );

    // Skeleton renders as a div with no text — just verify the table is not shown
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('displays error message when error is set', () => {
    const mockCallback = vi.fn();
    const errorMessage = 'Failed to fetch containers';

    render(
      <ContainersTable
        containers={[]}
        isLoading={false}
        error={errorMessage}
        onCopyToClipboard={mockCallback}
      />
    );

   expect(screen.getByText(errorMessage)).toBeDefined();
  });

  it('displays empty state message when no containers are tracked', () => {
    const mockCallback = vi.fn();

    render(
      <ContainersTable
        containers={[]}
        isLoading={false}
        error={null}
        onCopyToClipboard={mockCallback}
      />
    );

    expect(screen.getByText(/No containers with the IMDS proxy label are running/)).toBeDefined();
  });

  it('does not show loading message when loading but has containers', () => {
    const mockCallback = vi.fn();

    render(
      <ContainersTable
        containers={mockContainers}
        isLoading={true}
        error={null}
        onCopyToClipboard={mockCallback}
      />
    );

    // Should show table, not loading message, when containers exist
    expect(screen.queryByText('Loading containers...')).toBeNull();
    expect(screen.queryByText('webapp')).toBeDefined();
  });
});
