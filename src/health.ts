// Metro provides these at runtime; declare for TS since we don't ship @types/node
declare const require: (id: string) => any;
import type { AppDispatchOptions, HealthMetricsPayload } from "./types";
import type { DispatchProvider } from "./provider";
import { EventBuffer } from "./buffer";
import { snapshotFlagStates } from "./correlation";
import { installErrorHandler, installAppLaunchTracker } from "./auto-capture";
import { getDeviceId } from "./device-id";

/**
 * Auto-detect expo-updates info if available.
 */
function getExpoUpdatesInfo(): {
  updateUuid: string | null;
  runtimeVersion: string;
} {
  try {
    const Updates = require("expo-updates");
    return {
      updateUuid: Updates?.updateId ?? null,
      runtimeVersion: Updates?.runtimeVersion ?? "unknown",
    };
  } catch {
    return { updateUuid: null, runtimeVersion: "unknown" };
  }
}

/**
 * Auto-detect platform from React Native if not provided.
 */
function detectPlatform(): string {
  try {
    const { Platform } = require("react-native");
    return Platform?.OS ?? "unknown";
  } catch {
    return "unknown";
  }
}

export class HealthReporter {
  private readonly options: AppDispatchOptions;
  private readonly buffer: EventBuffer = new EventBuffer();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private teardownError: (() => void) | null = null;
  private teardownLaunch: (() => void) | null = null;
  private flagStateProvider: (() => Record<string, unknown>) | null = null;
  private provider: DispatchProvider | null = null;
  private started = false;
  private startupTimestamp: number | null = null;
  private hasRecordedColdStart = false;

  constructor(options: AppDispatchOptions) {
    this.options = options;
  }

  /** Set the provider reference (for awaiting readiness). Called internally by AppDispatch.init(). */
  setProvider(provider: DispatchProvider): void {
    this.provider = provider;
  }

  /**
   * Set the flag state provider for correlation.
   * Called internally by AppDispatch.init().
   */
  setFlagStateProvider(provider: () => Record<string, unknown>): void {
    this.flagStateProvider = provider;
  }

  /**
   * Start auto-capture hooks and flush timer.
   * Call once at app startup, after expo-updates has loaded.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.startupTimestamp = Date.now();

    if (this.options.autoCaptureErrors !== false) {
      this.teardownError = installErrorHandler((captured) => {
        const type = captured.isFatal ? "crash" : "js_error";
        const flagStates = snapshotFlagStates(this.flagStateProvider);
        this.buffer.add(type, undefined, captured.message, 1, flagStates, {
          stackTrace: captured.stackTrace,
          errorName: captured.errorName,
          componentStack: captured.componentStack,
          isFatal: captured.isFatal,
        });
        if (captured.isFatal) {
          this.flush();
        } else {
          this.checkBufferSize();
        }
      });
    }

    if (this.options.trackAppLaunches !== false) {
      this.teardownLaunch = installAppLaunchTracker(() => {
        const launchTimestamp = Date.now();
        // Wait for the flag provider to be ready so flag_states are populated
        // on app_launch events — required for per-variation error rate math.
        const ready = this.provider?.ready ?? Promise.resolve();
        ready.then(() => {
          const flagStates = snapshotFlagStates(this.flagStateProvider);
          this.buffer.add("app_launch", undefined, undefined, 1, flagStates);

          // Capture startup timing: first launch = cold start, subsequent = warm start
          const duration = Date.now() - launchTimestamp;
          if (!this.hasRecordedColdStart) {
            this.hasRecordedColdStart = true;
            this.recordPerformanceSample("startup_cold", duration);
          } else {
            this.recordPerformanceSample("startup_warm", duration);
          }

          this.flush();
        });
      });
    }

    const interval = this.options.healthFlushIntervalMs ?? 30_000;
    if (interval > 0) {
      this.flushTimer = setInterval(() => this.flush(), interval);
    }
  }

  /**
   * Stop all hooks and timers, flush remaining events.
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.teardownError) {
      this.teardownError();
      this.teardownError = null;
    }
    if (this.teardownLaunch) {
      this.teardownLaunch();
      this.teardownLaunch = null;
    }
    this.started = false;
    await this.flush();
  }

  /** Record a custom event (e.g. "checkout_success"). */
  recordEvent(name: string, count: number = 1): void {
    const flagStates = snapshotFlagStates(this.flagStateProvider);
    this.buffer.add("custom", name, undefined, count, flagStates);
    this.checkBufferSize();
  }

  /** Record an error manually (goes into js_error bucket). */
  recordError(
    messageOrError: string | Error,
    options?: { tags?: Record<string, string>; count?: number },
  ): void {
    const flagStates = snapshotFlagStates(this.flagStateProvider);
    const isError = messageOrError instanceof Error;
    const message = isError ? messageOrError.message : messageOrError;
    const count = options?.count ?? 1;

    this.buffer.add("js_error", undefined, message, count, flagStates, {
      errorName: isError ? messageOrError.name : undefined,
      stackTrace: isError ? messageOrError.stack : undefined,
      tags: options?.tags,
    });
    this.checkBufferSize();
  }

  /** Record a performance timing sample. */
  recordPerformanceSample(
    metric: "startup_cold" | "startup_warm" | "update_download" | "flag_eval",
    durationMs: number,
  ): void {
    this.buffer.add("perf_sample", metric, undefined, 1, undefined, {
      tags: { duration_ms: String(Math.round(durationMs)) },
    });
    this.checkBufferSize();
  }

  /** Force flush buffered events to the server. */
  async flush(): Promise<void> {
    const events = this.buffer.drain();
    if (events.length === 0) return;

    const autoDetected = getExpoUpdatesInfo();
    const updateUuid = this.options.updateId ?? autoDetected.updateUuid;
    const runtimeVersion =
      this.options.runtimeVersion ?? autoDetected.runtimeVersion;
    const platform = this.options.platform ?? detectPlatform();
    const deviceId = await getDeviceId(this.options.deviceId);

    const payload: HealthMetricsPayload = {
      projectSlug: this.options.projectSlug,
      updateUuid,
      deviceId,
      channel: this.options.channel ?? "default",
      platform,
      runtimeVersion,
      events,
    };

    try {
      const url = new URL("/v1/ota/health-metrics", this.options.baseUrl);
      const body = JSON.stringify(payload);

      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        console.warn(`[AppDispatch] Health metrics failed: ${res.status}`);
      }
    } catch (err) {
      console.warn("[AppDispatch] Health metrics failed:", err);
    }
  }

  private checkBufferSize(): void {
    const max = this.options.maxBufferSize ?? 100;
    if (this.buffer.size >= max) {
      this.flush();
    }
  }
}
