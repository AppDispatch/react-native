// ── SDK options ──

export interface AppDispatchOptions {
  /** Base URL of your AppDispatch server (e.g. "https://ota.example.com") */
  baseUrl: string;
  /** Project slug for routing metrics and fetching flags */
  projectSlug: string;
  /** Optional API key for authenticated requests */
  apiKey?: string;
  /** Channel name (e.g. "production", "staging") */
  channel?: string;
  /** Stable device identifier. Auto-generated and persisted if omitted. */
  deviceId?: string;
  /** Platform ("ios" | "android") — auto-detected from React Native if omitted */
  platform?: "ios" | "android";
  /** Current OTA update ID — auto-detected from expo-updates if omitted */
  updateId?: string | null;
  /** Runtime version string — auto-detected from expo-updates if omitted */
  runtimeVersion?: string;
  /** Polling interval in ms for refreshing flag definitions (default: 30000) */
  flagPollIntervalMs?: number;
  /** Flush interval in ms for sending flag evaluation reports (default: 60000) */
  flagFlushIntervalMs?: number;
  /** Flush interval in ms for health metrics (default: 30000). Set to 0 to disable. */
  healthFlushIntervalMs?: number;
  /** Whether to auto-capture JS errors via ErrorUtils (default: true) */
  autoCaptureErrors?: boolean;
  /** Whether to track app launches automatically (default: true) */
  trackAppLaunches?: boolean;
  /** Max health events to buffer before forcing a flush (default: 100) */
  maxBufferSize?: number;
}

// ── Flag types ──

export interface RuleDefinition {
  priority: number;
  ruleType: string;
  variantValue: unknown;
  ruleConfig: Record<string, unknown>;
}

export interface VariationDefinition {
  id: number;
  value: unknown;
  name: string | null;
}

export interface FlagDefinition {
  key: string;
  flagType: string;
  defaultValue: unknown;
  enabled: boolean;
  rules: RuleDefinition[];
  variations: VariationDefinition[];
}

export interface FlagPayload {
  flags: FlagDefinition[];
}

// ── Health types ──

export type HealthEventType = "js_error" | "crash" | "custom" | "app_launch" | "perf_sample";

export interface HealthEvent {
  type: HealthEventType;
  name?: string;
  message?: string;
  count: number;
  flagStates?: Record<string, unknown>;
  stackTrace?: string;
  errorName?: string;
  componentStack?: string;
  isFatal?: boolean;
  tags?: Record<string, string>;
}

export interface HealthMetricsPayload {
  projectSlug: string;
  updateUuid: string | null;
  deviceId: string;
  channel: string;
  platform: string;
  runtimeVersion: string;
  events: HealthEvent[];
}
