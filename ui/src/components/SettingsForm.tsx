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

import React, { useState, useEffect, useRef } from 'react';
import { Stack, TextField, Typography, Skeleton, Alert } from '@mui/material';
import Button from '@mui/material/Button';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import { DockerDesktopServiceClient } from '../services/dockerDesktopService';
import { isSettingsResponse } from '../types';
import { SAVE_DEBOUNCE_MS, BACKEND_REQUEST_TIMEOUT_MS } from '../constants';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), ms)
    ),
  ]);
}

interface SettingsFormProps {
  ddClient: ReturnType<typeof createDockerDesktopClient> | null;
  service: DockerDesktopServiceClient;
  showSnackbar: (message: string, severity: 'success' | 'error') => void;
  proxyUnreachable?: boolean;
  onProxyHelp?: () => void;
}

export function SettingsForm({ ddClient, service, showSnackbar, proxyUnreachable, onProxyHelp }: SettingsFormProps) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isDebouncing, setIsDebouncing] = useState(false);

  // Track mount status to prevent state updates after unmount during async settings load
  const isMountedRef = useRef(false);

  useEffect(() => {
    if (!ddClient) {
      return;
    }
    isMountedRef.current = true;

    // Load saved settings from backend
    const loadSettings = async () => {
      setIsLoadingSettings(true);
      try {
        const result = await withTimeout(service.getSettings(), BACKEND_REQUEST_TIMEOUT_MS);
        if (isSettingsResponse(result)) {
          const settings = result;
          const url = settings.url || '';

          if (isMountedRef.current) {
            setUrl(url);
            setSavedUrl(url);
          }
        } else if (isMountedRef.current) {
          showSnackbar('Unexpected settings response format', 'error');
        }
      } catch (error) {
        // Silently fall back to localStorage if the backend is unavailable.
        const savedUrl = localStorage.getItem('url') || '';
        if (isMountedRef.current) {
          setUrl(savedUrl);
          setSavedUrl(savedUrl);
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoadingSettings(false);
        }
      }
    };

    loadSettings();

    return () => {
      isMountedRef.current = false;
    };
  }, [ddClient, service, showSnackbar]);

  const handleSave = async () => {
    // Reset errors
    setUrlError('');

    if (!ddClient) {
      showSnackbar('Docker Desktop client unavailable', 'error');
      return;
    }

    // Validate URL
    if (!url) {
      setUrlError('URL is required');
      return;
    }
    if (!/^https?:\/\/[^/\\]/.test(url)) {
      setUrlError('Enter a valid URL (e.g. http://localhost:8080)');
      return;
    }

    setIsSaving(true);

    try {
      const settings = { url };

      await withTimeout(
        ddClient.extension.vm?.service?.post('/settings', settings) ?? Promise.resolve(),
        BACKEND_REQUEST_TIMEOUT_MS,
      );

      // Save settings locally after successful backend save
      localStorage.setItem('url', url);

      // Update saved state to disable button
      setSavedUrl(url);
      showSnackbar('Settings saved', 'success');

      // Disable save button to prevent rapid re-submission
      setIsDebouncing(true);
      const debounceTimer = setTimeout(() => {
        if (isMountedRef.current) {
          setIsDebouncing(false);
        }
      }, SAVE_DEBOUNCE_MS);

      return () => clearTimeout(debounceTimer);
    } catch (error) {
      // On error, don't update saved state so button stays enabled
      console.error('Failed to save settings:', error);
      showSnackbar('Failed to save settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1">Settings</Typography>
      {proxyUnreachable && (
        <Alert
          severity="warning"
          action={
            onProxyHelp && (
              <Button color="inherit" size="small" onClick={onProxyHelp}>
                Get help
              </Button>
            )
          }
        >
          Extension backend not responding. Your last saved settings are shown below, but changes cannot be saved.
        </Alert>
      )}
      {isLoadingSettings ? (
        <Skeleton variant="rectangular" height={40} />
      ) : (
        <>
          <TextField
            type="text"
            label="IMDS server URL"
            placeholder="http://localhost:8080"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError('');
            }}
            variant="outlined"
            size="small"
            error={!!urlError}
            helperText={urlError || 'Examples: http://localhost:8080, https://api.example.com'}
            fullWidth
            spellCheck={false}
          />
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={isSaving || url === savedUrl || isDebouncing || proxyUnreachable}
            sx={{ alignSelf: 'flex-start' }}
          >
            {isSaving ? 'Saving...' : url === savedUrl && savedUrl !== '' ? 'Saved' : 'Save Settings'}
          </Button>
        </>
      )}
    </Stack>
  );
}
