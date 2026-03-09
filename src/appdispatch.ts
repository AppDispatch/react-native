import { OpenFeature } from "@openfeature/react-sdk";
import type { AppDispatchOptions } from "./types";
import { DispatchProvider } from "./provider";
import { HealthReporter } from "./health";

let _instance: AppDispatchInstance | null = null;

export interface AppDispatchInstance {
  /** The OpenFeature provider (for advanced use). */
  provider: DispatchProvider;
  /** The health reporter (for recording custom events/errors). */
  health: HealthReporter;
  /** Start health monitoring. Call in your root layout's useEffect. */
  start(): void;
  /** Stop health monitoring and flush remaining events. */
  stop(): Promise<void>;
}

/** No-op instance returned when AppDispatch.instance is accessed before init(). */
const _noopHealth = {
  start() {},
  async stop() {},
  recordEvent() {},
  recordError() {},
  async flush() {},
  setFlagStateProvider() {},
} as unknown as HealthReporter;

const _noopInstance: AppDispatchInstance = {
  provider: {} as DispatchProvider,
  health: _noopHealth,
  start() {},
  async stop() {},
};

export const AppDispatch = {
  /**
   * Initialize AppDispatch with a single config object.
   * Sets up feature flags (via OpenFeature) and health monitoring.
   *
   * ```ts
   * import { AppDispatch } from "@appdispatch/react-native";
   *
   * AppDispatch.init({
   *   baseUrl: "https://ota.example.com",
   *   projectSlug: "my-app",
   *   apiKey: "dsp_...",
   *   channel: "production",
   * });
   * ```
   */
  init(options: AppDispatchOptions): AppDispatchInstance {
    if (_instance) return _instance;

    const provider = new DispatchProvider(options);
    const health = new HealthReporter(options);

    // Wire flag-health correlation internally
    health.setFlagStateProvider(() => provider.getFlagStates());

    // Register with OpenFeature
    OpenFeature.setProvider(provider);

    _instance = {
      provider,
      health,
      start: () => health.start(),
      stop: () => health.stop(),
    };

    return _instance;
  },

  /** Get the current AppDispatch instance. Warns and no-ops if not initialized. */
  get instance(): AppDispatchInstance {
    if (!_instance) {
      console.warn(
        "[AppDispatch] Not initialized. Call AppDispatch.init() before using AppDispatch.instance.",
      );
      return _noopInstance;
    }
    return _instance;
  },
};
