import type {
  CommonProvider,
  ClientProviderStatus,
  EvaluationContext,
  JsonValue,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/core";
import { ErrorCode } from "@openfeature/core";
import { OpenFeatureEventEmitter } from "@openfeature/web-sdk";
import type { ProviderEmittableEvents } from "@openfeature/web-sdk";
import type {
  AppDispatchOptions,
  EvaluatedFlag,
  BulkEvalResponse,
} from "./types";
import type { CachedFlags } from "./cache";
import { loadCachedFlags, persistFlags } from "./cache";
import { SSEClient } from "./sse-client";
import { getDeviceId } from "./device-id";

// Metro provides require at runtime; declare for TS since we don't ship @types/node
declare const require: (id: string) => any;

/** Auto-detect expo-updates info if available. */
function getExpoUpdatesInfo(): {
  updateId: string | null;
  runtimeVersion: string;
} {
  try {
    const Updates = require("expo-updates");
    return {
      updateId: Updates?.updateId ?? null,
      runtimeVersion: Updates?.runtimeVersion ?? "unknown",
    };
  } catch {
    return { updateId: null, runtimeVersion: "unknown" };
  }
}

export class DispatchProvider implements CommonProvider<ClientProviderStatus> {
  readonly metadata: ProviderMetadata = { name: "appdispatch" };
  readonly runsOn = "client" as const;
  readonly events = new OpenFeatureEventEmitter();

  private flags: Map<string, EvaluatedFlag> = new Map();
  private sseClient: SSEClient | null = null;
  private lastKnownFlagStates: Record<string, unknown> = {};
  private readonly options: AppDispatchOptions;
  private deviceId: string = "";
  private updateId: string | null = null;
  private runtimeVersion: string = "unknown";
  private _readyResolve!: () => void;
  /** Resolves when cached flags are loaded (or initial bulk eval completes). */
  readonly ready: Promise<void>;

  constructor(options: AppDispatchOptions) {
    this.options = options;
    this.ready = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
  }

  /** Returns a snapshot of the last known flag states (used by health reporter). */
  getFlagStates(): Record<string, unknown> {
    return { ...this.lastKnownFlagStates };
  }

  async initialize(): Promise<void> {
    // Resolve device ID (may be async via AsyncStorage)
    this.deviceId = await getDeviceId(this.options.deviceId);

    // Resolve update/runtime info (explicit options override auto-detection)
    const autoDetected = getExpoUpdatesInfo();
    this.updateId = this.options.updateId ?? autoDetected.updateId;
    this.runtimeVersion =
      this.options.runtimeVersion ?? autoDetected.runtimeVersion;

    // Load cached flags from AsyncStorage
    const cached = await loadCachedFlags();
    if (cached) {
      this.populateFlagsFromRecord(cached);
    } else {
      // No cache (first launch): fetch from server
      await this.fetchBulkEval();
    }

    // Mark ready -- app can render with flags immediately
    this._readyResolve();

    // Connect SSE in background for live updates
    this.connectSSE();
  }

  async onClose(): Promise<void> {
    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): ResolutionDetails<boolean> {
    return this.resolve(flagKey, defaultValue, context);
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
  ): ResolutionDetails<string> {
    return this.resolve(flagKey, defaultValue, context);
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
  ): ResolutionDetails<number> {
    return this.resolve(flagKey, defaultValue, context);
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
  ): ResolutionDetails<T> {
    return this.resolve(flagKey, defaultValue, context);
  }

  /** Simple cache lookup -- no local evaluation. */
  private resolve<T>(
    flagKey: string,
    defaultValue: T,
    _context: EvaluationContext,
  ): ResolutionDetails<T> {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      return {
        value: defaultValue,
        reason: "ERROR",
        errorCode: ErrorCode.FLAG_NOT_FOUND,
        errorMessage: `Flag "${flagKey}" not found`,
      };
    }

    const value = (flag.value as T) ?? defaultValue;
    this.lastKnownFlagStates[flagKey] = value;

    return {
      value,
      variant: flag.variant,
      reason: flag.reason,
    };
  }

  /** Get all currently loaded flags (for debugging). */
  getFlags(): ReadonlyMap<string, EvaluatedFlag> {
    return this.flags;
  }

  /** Fetch bulk-evaluated flags from the server (first launch only). */
  private async fetchBulkEval(): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.options.apiKey) {
        headers["Authorization"] = `Bearer ${this.options.apiKey}`;
      }

      const url = new URL(
        "/v1/ota/flag-evaluations-bulk",
        this.options.baseUrl,
      );
      const res = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectSlug: this.options.projectSlug,
          channel: this.options.channel,
          deviceId: this.deviceId,
          targetingKey: "",
          platform: this.options.platform,
          runtimeVersion: this.runtimeVersion,
          attributes: this.updateId
            ? { update_id: this.updateId }
            : undefined,
        }),
      });

      if (!res.ok) {
        console.warn(`[AppDispatch] Bulk eval failed: ${res.status}`);
        return;
      }

      const payload: BulkEvalResponse = await res.json();
      this.populateFlagsFromRecord(payload.flags);
      await persistFlags(payload.flags);
    } catch (err) {
      console.warn("[AppDispatch] Bulk eval failed:", err);
    }
  }

  /** Connect SSE for live flag updates. */
  private connectSSE(): void {
    this.sseClient = new SSEClient({
      baseUrl: this.options.baseUrl,
      projectSlug: this.options.projectSlug,
      channel: this.options.channel,
      deviceId: this.deviceId,
      targetingKey: undefined,
      updateId: this.updateId,
      runtimeVersion: this.runtimeVersion,
      platform: this.options.platform,
      apiKey: this.options.apiKey,
      onPut: (flags: CachedFlags) => {
        this.populateFlagsFromRecord(flags);
        persistFlags(flags);
        this.emitConfigChanged(Object.keys(flags));
      },
      onPatch: (key: string, flag: EvaluatedFlag) => {
        this.flags.set(key, flag);
        this.lastKnownFlagStates[key] = flag.value;
        persistFlags(this.flagsToRecord());
        this.emitConfigChanged([key]);
      },
      onDelete: (key: string) => {
        this.flags.delete(key);
        delete this.lastKnownFlagStates[key];
        persistFlags(this.flagsToRecord());
        this.emitConfigChanged([key]);
      },
      onError: (err: any) => {
        console.warn("[AppDispatch] SSE error:", err);
      },
    });

    this.sseClient.connect();
  }

  /** Populate the flags Map and lastKnownFlagStates from a Record. */
  private populateFlagsFromRecord(record: CachedFlags): void {
    this.flags = new Map(Object.entries(record));
    this.populateLastKnownStates();
  }

  /** Populate lastKnownFlagStates from the current flags Map. */
  private populateLastKnownStates(): void {
    this.lastKnownFlagStates = {};
    for (const [key, flag] of this.flags) {
      this.lastKnownFlagStates[key] = flag.value;
    }
  }

  /** Convert the flags Map to a plain record for cache persistence. */
  private flagsToRecord(): CachedFlags {
    const record: CachedFlags = {};
    for (const [key, flag] of this.flags) {
      record[key] = flag;
    }
    return record;
  }

  /** Notify OpenFeature that flag values changed so React hooks re-render. */
  private emitConfigChanged(flagsChanged: string[]): void {
    this.events.emit("PROVIDER_CONFIGURATION_CHANGED" as ProviderEmittableEvents, {
      flagsChanged,
    });
  }
}
