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

  // Container state
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [isLoadingContainers, setIsLoadingContainers] = useState(false);
  const [containersError, setContainersError] = useState<string | null>(null);

  // Snackbar notification state
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');

  // App metadata
  const [appDescription, setAppDescription] = useState('');

  // Track mount status to prevent state updates after unmount during async operations
  // This avoids "Can't perform a React state update on an unmounted component" warnings
  // during container polling
  const isMountedRef = useRef(false);

  const showSnackbar = useCallback((message: string, severity: 'success' | 'error') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  }, []);

  const loadContainers = useCallback(async () => {
    if (!ddClient || !isMountedRef.current) {
      return;
    }

    setIsLoadingContainers(true);
    setContainersError(null);

    try {
      const result = await service.getContainers();
      if (isContainersResponse(result) && isMountedRef.current) {
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

    // Poll more frequently for faster updates
    const interval = setInterval(loadContainers, CONTAINER_POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [ddClient, loadContainers]);

  useEffect(() => {
    fetch('./description.json')
      .then(res => res.json())
      .then(data => {
        if (data.description) {
          setAppDescription(data.description);
        }
      })
      .catch(() => {
        // Fail silently if description.json can't be loaded
      });
  }, []);

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
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
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

      <Stack spacing={1.5}>
        <Typography variant="body1">
          {appDescription}
        </Typography>
      </Stack>

      <SettingsForm ddClient={ddClient} service={service} showSnackbar={showSnackbar} />

      <Stack spacing={2}>
        <Typography variant="body1" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
          Add a
          <Box
            component="code"
            sx={{
              px: 0.5,
              py: 0.25,
              borderRadius: 0.5,
              bgcolor: 'action.hover',
              fontFamily: 'monospace',
            }}
          >
            {IMDS_PROXY_ENABLED_LABEL}
            <Tooltip title="Copy label">
              <IconButton
                size="small"
                aria-label="Copy label text"
                onClick={() => copyToClipboard(IMDS_PROXY_ENABLED_LABEL, 'label')}
                sx={{ padding: '2px' }}
              >
                <ContentCopyIcon fontSize="inherit" sx={{ fontSize: '0.75rem' }} />
              </IconButton>
            </Tooltip>
          </Box>
          label to containers to enable IMDS proxying for them.
        </Typography>
        <ContainersTable
          containers={containers}
          isLoading={isLoadingContainers}
          error={containersError}
          onCopyToClipboard={copyToClipboard}
        />
      </Stack>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={SNACKBAR_AUTO_HIDE_DURATION_MS}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} variant="filled">
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
