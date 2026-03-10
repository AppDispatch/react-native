// Metro provides require at runtime; declare for TS since we don't ship @types/node
declare const require: (id: string) => any;
declare const __DEV__: boolean | undefined;

import { useEffect } from "react";
import { getDeviceId } from "./device-id";
import { AppDispatch } from "./appdispatch";

/**
 * Hook that checks for OTA updates on mount.
 * Sets the device ID header for rollout bucketing.
 * Critical updates reload immediately; others apply on next launch.
 * No-ops in __DEV__ mode.
 */
export function useOTAUpdates() {
  useEffect(() => {
    if (__DEV__) return;

    async function checkForUpdate() {
      try {
        const Updates = require("expo-updates");

        const deviceId = await getDeviceId();

        try {
          Updates.setUpdateRequestHeadersOverride({
            "expo-device-id": deviceId,
          });
        } catch {
          // Requires native config with EXUpdatesRequestHeaders — skip silently
        }

        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable) return;

        const downloadStart = Date.now();
        const result = await Updates.fetchUpdateAsync();
        if (!result.isNew) return;

        // Record successful download duration as a performance sample
        const downloadDuration = Date.now() - downloadStart;
        AppDispatch.instance.health.recordPerformanceSample(
          "update_download",
          downloadDuration,
        );

        // Critical updates reload immediately; others apply on next launch
        const manifest = (check.manifest ?? result.manifest) as any;
        if (manifest?.metadata?.isCritical === true) {
          await Updates.reloadAsync();
        }
      } catch (err: any) {
        console.warn("[AppDispatch] Update check failed:", err.message);
      }
    }

    checkForUpdate();
  }, []);
}
