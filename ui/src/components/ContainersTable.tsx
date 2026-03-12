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

import React, { useState, useMemo } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Chip,
  IconButton,
  Tooltip,
  Typography,
  TablePagination,
  Stack,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { ContainerInfo } from '../types';
import { CONTAINER_ID_DISPLAY_LENGTH } from '../constants';
import { cleanContainerName } from '../utils/containerUtils';

interface ContainersTableProps {
  containers: ContainerInfo[];
  isLoading: boolean;
  error: string | null;
  onCopyToClipboard: (text: string, label: string) => void;
}

export function ContainersTable({
  containers,
  isLoading,
  error,
  onCopyToClipboard,
}: ContainersTableProps) {
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'id'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const handleSort = (column: 'name' | 'id') => {
    const isAsc = sortBy === column && sortOrder === 'asc';
    setSortOrder(isAsc ? 'desc' : 'asc');
    setSortBy(column);
  };

  const sortedContainers = useMemo(() => {
    const sorted = [...containers].sort((a, b) => {
      let aValue: string;
      let bValue: string;

      if (sortBy === 'name') {
        aValue = cleanContainerName(a.name).toLowerCase();
        bValue = cleanContainerName(b.name).toLowerCase();
      } else {
        aValue = a.containerId;
        bValue = b.containerId;
      }

      if (sortOrder === 'asc') {
        return aValue.localeCompare(bValue);
      } else {
        return bValue.localeCompare(aValue);
      }
    });

    return sorted;
  }, [containers, sortBy, sortOrder]);

  const paginatedContainers = useMemo(() => {
    const startIndex = page * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    return sortedContainers.slice(startIndex, endIndex);
  }, [sortedContainers, page, rowsPerPage]);

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleCopyClick = (text: string, label: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent row selection when clicking copy button
    onCopyToClipboard(text, label);
  };

  if (isLoading && containers.length === 0) {
    return (
      <Typography variant="body1" color="text.secondary">
        Loading containers...
      </Typography>
    );
  }

  if (error) {
    return (
      <Typography variant="body1" color="error">
        {error}
      </Typography>
    );
  }

  if (containers.length === 0) {
    return (
      <Typography variant="body1" color="text.secondary">
        No tracked containers found
      </Typography>
    );
  }

  return (
    <>
      <Typography variant="h6">Enabled for these containers</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>
                <TableSortLabel
                  active={sortBy === 'name'}
                  direction={sortBy === 'name' ? sortOrder : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortBy === 'id'}
                  direction={sortBy === 'id' ? sortOrder : 'asc'}
                  onClick={() => handleSort('id')}
                >
                  Container ID
                </TableSortLabel>
              </TableCell>
              <TableCell>Networks</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedContainers.map((container) => {
              const displayName = cleanContainerName(container.name);
              return (
                <TableRow
                  key={container.containerId}
                  hover
                  selected={selectedContainer === container.containerId}
                  onClick={() => setSelectedContainer(container.containerId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedContainer(container.containerId);
                    }
                  }}
                  tabIndex={0}
                  sx={{
                    cursor: 'pointer',
                    '& .copy-button': {
                      opacity: 0,
                      pointerEvents: 'none',
                      transition: 'opacity 120ms ease-in-out',
                    },
                    '&:hover .copy-button': {
                      opacity: 1,
                      pointerEvents: 'auto',
                    },
                    '&:focus-within .copy-button': {
                      opacity: 1,
                      pointerEvents: 'auto',
                    },
                  }}
                >
                  <TableCell>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Typography variant="body1">{displayName}</Typography>
                      <Tooltip title="Copy name">
                        <IconButton
                          size="small"
                          aria-label={`Copy container name ${displayName}`}
                          onClick={(e) => handleCopyClick(displayName, 'container name', e)}
                          className="copy-button"
                          sx={{ padding: '2px' }}
                        >
                          <ContentCopyIcon fontSize="inherit" sx={{ fontSize: '0.75rem' }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Typography
                        variant="body1"
                        sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                      >
                        {container.containerId.substring(0, CONTAINER_ID_DISPLAY_LENGTH)}
                      </Typography>
                      <Tooltip title="Copy full ID">
                        <IconButton
                          size="small"
                          aria-label={`Copy container id ${container.containerId}`}
                          onClick={(e) => handleCopyClick(container.containerId, 'container ID', e)}
                          className="copy-button"
                          sx={{ padding: '2px' }}
                        >
                          <ContentCopyIcon fontSize="inherit" sx={{ fontSize: '0.75rem' }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {[...container.networks]
                        .sort((a, b) => a.networkName.localeCompare(b.networkName))
                        .map((network) => (
                          <Chip
                            key={network.networkId}
                            label={network.networkName}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {containers.length > 0 && (
        <TablePagination
          rowsPerPageOptions={[10, 25, 50, 100]}
          component="div"
          count={containers.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      )}
    </>
  );
}
