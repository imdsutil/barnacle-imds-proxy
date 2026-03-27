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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import { useDockerDesktopService } from './services/dockerDesktopService';
import logo from './logo.svg';
import {
  CONTAINER_POLL_INTERVAL_MS,
  SNACKBAR_AUTO_HIDE_DURATION_MS,
  GITHUB_REPO_URL,
  IMDS_PROXY_ENABLED_LABEL,
} from './constants';
import {
  ContainerInfo,
  isContainersResponse,
} from './types';
import { ContainersTable } from './components/ContainersTable';
import { SettingsForm } from './components/SettingsForm';
import {
  Stack,
  Typography,
  Box,
  IconButton,
  Tooltip,
  Snackbar,
  Alert,
  Link,
  Tabs,
  Tab,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

// Note: This line relies on Docker Desktop's presence as a host application.
// If you're running this React app in a browser, it won't work properly.
function useDockerDesktopClient() {
  const [client, setClient] = useState<ReturnType<typeof createDockerDesktopClient> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const createdClient = createDockerDesktopClient();
      setClient(createdClient);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize Docker Desktop client';
      setError(message);
    }
  }, []);

  return { client, error };
}

export function App() {
  const { client: ddClient, error: clientError } = useDockerDesktopClient();
  const service = useDockerDesktopService(ddClient);

  const [activeTab, setActiveTab] = useState(0);

  // Container state
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [isLoadingContainers, setIsLoadingContainers] = useState(false);
  const [containersError, setContainersError] = useState<string | null>(null);

  // Snackbar notification state
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');

  // Track mount status to prevent state updates after unmount during async operations
  const isMountedRef = useRef(false);
  // Only show the loading skeleton on the first fetch, not on background poll refreshes
  const hasLoadedOnceRef = useRef(false);

  const showSnackbar = useCallback((message: string, severity: 'success' | 'error') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  }, []);

  const loadContainers = useCallback(async () => {
    if (!ddClient || !isMountedRef.current) {
      return;
    }

    if (!hasLoadedOnceRef.current) {
      setIsLoadingContainers(true);
    }
    setContainersError(null);

    try {
      const result = await service.getContainers();
      if (isContainersResponse(result) && isMountedRef.current) {
        hasLoadedOnceRef.current = true;
        setContainers(result);
      } else if (isMountedRef.current) {
        showSnackbar('Unexpected containers response format', 'error');
      }
    } catch (error) {
      console.error('Failed to load containers:', error);
      if (isMountedRef.current) {
        showSnackbar('Failed to load containers', 'error');
        setContainersError('Failed to refresh containers');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingContainers(false);
      }
    }
  }, [ddClient, service, showSnackbar]);

  useEffect(() => {
    if (clientError) {
      showSnackbar(clientError, 'error');
    }
  }, [clientError, showSnackbar]);

  useEffect(() => {
    if (!ddClient) {
      return;
    }
    isMountedRef.current = true;

    loadContainers();

    const interval = setInterval(loadContainers, CONTAINER_POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [ddClient, loadContainers]);

  const copyToClipboard = (text: string, label: string) => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showSnackbar('Clipboard not available', 'error');
      return;
    }

    navigator.clipboard.writeText(text)
      .then(() => {
        showSnackbar(`Copied ${label} to clipboard`, 'success');
      })
      .catch(err => {
        console.error('Failed to copy to clipboard:', err);
        showSnackbar('Failed to copy to clipboard', 'error');
      });
  };

  const handleSnackbarClose = () => {
    setSnackbarOpen(false);
  };

  const handleOpenDocumentation = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (ddClient?.host?.openExternal) {
      ddClient.host.openExternal(GITHUB_REPO_URL);
      return;
    }

    window.open(GITHUB_REPO_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <Box sx={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', pt: 0, pr: 1, pb: 3, pl: 0 }}>
      {/* Header */}
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            component="img"
            src={logo}
            alt="Barnacle Logo"
            sx={{ width: 40, height: 40 }}
          />
          <Typography variant="h3">
            Barnacle IMDS Proxy
          </Typography>
        </Stack>
        <Link
          href={GITHUB_REPO_URL}
          onClick={handleOpenDocumentation}
          sx={{ display: 'flex', gap: 0.5, alignItems: 'center', textDecoration: 'none' }}
        >
          <OpenInNewIcon fontSize="small" />
          <Typography variant="body1">View documentation</Typography>
        </Link>
      </Stack>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_e, newValue: number) => setActiveTab(newValue)}
        sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Containers" />
        <Tab label="Settings" />
      </Tabs>

      {/* Containers tab */}
      {activeTab === 0 && (
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="body2">
              Add the following label to a container to enable IMDS proxying:
            </Typography>
            <Box
              component="code"
              sx={{
                px: 1,
                py: 0.25,
                borderRadius: 0.5,
                bgcolor: 'action.hover',
                border: '1px solid',
                borderColor: 'divider',
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                whiteSpace: 'nowrap',
              }}
            >
              {IMDS_PROXY_ENABLED_LABEL}
            </Box>
            <Tooltip title="Copy label">
              <IconButton
                size="small"
                aria-label="Copy label to clipboard"
                onClick={() => copyToClipboard(IMDS_PROXY_ENABLED_LABEL, 'label')}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          <ContainersTable
            containers={containers}
            isLoading={isLoadingContainers}
            error={containersError}
            onCopyToClipboard={copyToClipboard}
            onRetry={loadContainers}
          />
        </Box>
      )}

      {/* Settings tab */}
      {activeTab === 1 && (
        <Box sx={{ maxWidth: 600 }}>
          <SettingsForm ddClient={ddClient} service={service} showSnackbar={showSnackbar} />
        </Box>
      )}

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={SNACKBAR_AUTO_HIDE_DURATION_MS}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} variant="standard">
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
}
