import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { useInterval } from 'usehooks-ts';
import { useUpdateNotification } from '../hooks/useUpdateNotification.js';
import { Box, Text } from '../ink.js';
import { type AutoUpdaterResult } from '../utils/autoUpdater.js';
import {
  checkForUpdates as checkForUpdatesFromModule,
  handleAutoUpdate,
  isUpdateInProgress,
  updateEventEmitter,
  UPDATE_EVENTS,
} from '../utils/autoUpgrade.js';
import { getGlobalConfig, isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
import { getInitialSettings } from '../utils/settings/settings.js';
import { gt, gte } from '../utils/semver.js';
import { getMaxVersion } from '../utils/autoUpdater.js';

type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};

export function AutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose
}: Props): React.ReactNode {
  const [versions, setVersions] = useState<{
    global?: string | null;
    latest?: string | null;
  }>({});
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'success' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const updateSemver = useUpdateNotification(autoUpdaterResult?.version);

  // Track latest isUpdating value in a ref
  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;

  // Set up event listeners for update events
  useEffect(() => {
    const handleUpdateReceived = () => {
      setUpdateStatus('available');
    };

    const handleUpdateSuccess = () => {
      setUpdateStatus('success');
      onChangeIsUpdating(false);
    };

    const handleUpdateFailed = (data: { message: string }) => {
      setUpdateStatus('failed');
      setErrorMessage(data.message);
      onChangeIsUpdating(false);
    };

    const handleUpdateInfo = (data: { message: string }) => {
      logForDebugging('AutoUpdater: ' + data.message);
    };

    updateEventEmitter.on(UPDATE_EVENTS.UPDATE_RECEIVED, handleUpdateReceived);
    updateEventEmitter.on(UPDATE_EVENTS.UPDATE_SUCCESS, handleUpdateSuccess);
    updateEventEmitter.on(UPDATE_EVENTS.UPDATE_FAILED, handleUpdateFailed);
    updateEventEmitter.on(UPDATE_EVENTS.UPDATE_INFO, handleUpdateInfo);

    return () => {
      updateEventEmitter.off(UPDATE_EVENTS.UPDATE_RECEIVED, handleUpdateReceived);
      updateEventEmitter.off(UPDATE_EVENTS.UPDATE_SUCCESS, handleUpdateSuccess);
      updateEventEmitter.off(UPDATE_EVENTS.UPDATE_FAILED, handleUpdateFailed);
      updateEventEmitter.off(UPDATE_EVENTS.UPDATE_INFO, handleUpdateInfo);
    };
  }, [onChangeIsUpdating]);

  const performAutoUpdateCheck = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return;
    }

    // @ts-ignore - build-time constant check
    if ("production" === 'test' || "production" === 'development') {
      logForDebugging('AutoUpdater: Skipping update check in test/dev environment');
      return;
    }

    const currentVersion = MACRO.VERSION;
    const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';
    const isDisabled = isAutoUpdaterDisabled();

    // Check if max version is set (server-side kill switch for auto-updates)
    let latestVersion: string | null = null;
    try {
      const updateInfo = await checkForUpdatesFromModule(MACRO.PACKAGE_URL, currentVersion);
      if (updateInfo?.update?.latest) {
        latestVersion = updateInfo.update.latest;
      }
    } catch (e) {
      logForDebugging('AutoUpdater: Failed to check for updates: ' + e);
    }

    const maxVersion = await getMaxVersion();
    if (maxVersion && latestVersion && gt(latestVersion, maxVersion)) {
      logForDebugging(`AutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latestVersion} to ${maxVersion}`);
      if (gte(currentVersion, maxVersion)) {
        logForDebugging(`AutoUpdater: current version ${currentVersion} is already at or above maxVersion ${maxVersion}, skipping update`);
        setVersions({
          global: currentVersion,
          latest: latestVersion
        });
        return;
      }
      latestVersion = maxVersion;
    }

    setVersions({
      global: currentVersion,
      latest: latestVersion
    });

    // Check if update needed and trigger update
    if (!isDisabled && currentVersion && latestVersion && !gte(currentVersion, latestVersion)) {
      const startTime = Date.now();
      onChangeIsUpdating(true);
      setUpdateStatus('available');

      // Detect actual running installation type
      const installationType = await getCurrentInstallationType();
      logForDebugging(`AutoUpdater: Detected installation type: ${installationType}`);

      // Skip update for development builds
      if (installationType === 'development') {
        logForDebugging('AutoUpdater: Cannot auto-update development build');
        onChangeIsUpdating(false);
        setUpdateStatus('idle');
        return;
      }

      // Use handleAutoUpdate which spawns a detached process
      const settings = getInitialSettings();
      handleAutoUpdate(
        {
          message: `OpenCC update available! ${currentVersion} → ${latestVersion}`,
          update: {
            latest: latestVersion,
            current: currentVersion,
            name: MACRO.PACKAGE_URL
          }
        },
        settings as any,
        process.cwd(),
        false
      );

      // Note: handleAutoUpdate is non-blocking, status updates come via events
    }
  }, [onChangeIsUpdating]);

  // Initial check
  useEffect(() => {
    void performAutoUpdateCheck();
  }, [performAutoUpdateCheck]);

  // Check every 30 minutes
  useInterval(performAutoUpdateCheck, 30 * 60 * 1000);

  if (!autoUpdaterResult?.version && (!versions.global || !versions.latest)) {
    return null;
  }

  if (!autoUpdaterResult?.version && !isUpdating) {
    return null;
  }

  return (
    <Box flexDirection="row" gap={1}>
      {verbose && (
        <Text dimColor wrap="truncate">
          globalVersion: {versions.global} &middot; latestVersion: {versions.latest}
        </Text>
      )}
      {isUpdating ? (
        <Box>
          <Text color="text" dimColor wrap="truncate">
            Auto-updating…
          </Text>
        </Box>
      ) : autoUpdaterResult?.status === 'success' && showSuccessMessage && updateSemver ? (
        <Text color="success" wrap="truncate">
          ✓ Update installed · Restart to apply
        </Text>
      ) : autoUpdaterResult?.status === 'install_failed' || autoUpdaterResult?.status === 'no_permissions' ? (
        <Text color="error" wrap="truncate">
          ✗ Auto-update failed · Try <Text bold>opencc doctor</Text> or{' '}
          <Text bold>
            {`npm i -g ${MACRO.PACKAGE_URL}`}
          </Text>
        </Text>
      ) : null}
    </Box>
  );
}
