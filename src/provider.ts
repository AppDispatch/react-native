import type {
  CommonProvider,
  ClientProviderStatus,
  EvaluationContext,
  JsonValue,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/core";
import { ErrorCode } from "@openfeature/core";
import type { AppDispatchOptions, FlagDefinition, FlagPayload } from "./types";
import { evaluateFlag } from "./evaluator";

interface EvalBuffer {
  [compositeKey: string]: {
    flagKey: string;
    variationValue: unknown;
    count: number;
  };
}

export class DispatchProvider implements CommonProvider<ClientProviderStatus> {
  readonly metadata: ProviderMetadata = { name: "appdispatch" };
  readonly runsOn = "client" as const;

  private flags: Map<string, FlagDefinition> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private evalBuffer: EvalBuffer = {};
  private lastKnownFlagStates: Record<string, unknown> = {};
  private lastContext: EvaluationContext | null = null;
  private readonly options: AppDispatchOptions;
  private _readyResolve!: () => void;
  private evalTimingHook: ((flagKey: string, durationMs: number) => void) | null = null;
  /** Resolves when the first flag fetch completes. */
  readonly ready: Promise<void>;

  constructor(options: AppDispatchOptions) {
    this.options = options;
    this.ready = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
  }

  /** Set a hook to capture flag evaluation timing. Called internally by AppDispatch.init(). */
  setEvalTimingHook(hook: (flagKey: string, durationMs: number) => void): void {
    this.evalTimingHook = hook;
  }

  /** Returns a snapshot of the last known flag states (used by health reporter). */
  getFlagStates(): Record<string, unknown> {
    return { ...this.lastKnownFlagStates };
  }

  async initialize(): Promise<void> {
    await this.fetchFlags();
    this._readyResolve();

    const interval = this.options.flagPollIntervalMs ?? 30_000;
    if (interval > 0) {
      this.pollTimer = setInterval(() => this.fetchFlags(), interval);
    }

    const flushInterval = this.options.flagFlushIntervalMs ?? 60_000;
    if (flushInterval > 0) {
      this.flushTimer = setInterval(() => this.flush(), flushInterval);
    }
  }

  async onClose(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
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

  private resolve<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
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

    const evalStart = Date.now();
    const result = evaluateFlag(flag, context);
    const evalDuration = Date.now() - evalStart;
    const value = (result.value as T) ?? defaultValue;

    if (this.evalTimingHook) {
      this.evalTimingHook(flagKey, evalDuration);
    }

    this.trackEvaluation(flagKey, value, context);

    return {
      value,
      variant: result.variant,
      reason: result.reason,
    };
  }

  private trackEvaluation(
    flagKey: string,
    value: unknown,
    context: EvaluationContext,
  ): void {
    const key = `${flagKey}::${JSON.stringify(value)}`;
    if (this.evalBuffer[key]) {
      this.evalBuffer[key].count++;
    } else {
      this.evalBuffer[key] = { flagKey, variationValue: value, count: 1 };
    }
    this.lastKnownFlagStates[flagKey] = value;
    this.lastContext = context;
  }

  /** Flush buffered evaluations to the server. */
  async flush(): Promise<void> {
    const entries = Object.values(this.evalBuffer);
    const context = this.lastContext;
    if (entries.length === 0) return;

    this.evalBuffer = {};
    this.lastContext = null;

    const body: Record<string, unknown> = {
      evaluations: entries.map((e) => ({
        flagKey: e.flagKey,
        variationValue: e.variationValue,
        count: e.count,
        channel: this.options.channel ?? null,
      })),
    };

    if (context?.targetingKey) {
      body.context = {
        targetingKey: context.targetingKey,
        kind: (context.kind as string) ?? "user",
        name: (context.name as string) ?? null,
        attributes: Object.fromEntries(
          Object.entries(context).filter(
            ([k]) => !["targetingKey", "kind", "name"].includes(k),
          ),
        ),
      };
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.options.apiKey) {
        headers["Authorization"] = `Bearer ${this.options.apiKey}`;
      }

      const url = new URL("/v1/ota/flag-evaluations", this.options.baseUrl);
      const res = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`[AppDispatch] Failed to report evaluations: ${res.status}`);
      }
    } catch (err) {
      console.warn("[AppDispatch] Failed to report evaluations:", err);
    }
  }

  private async fetchFlags(): Promise<void> {
    try {
      const url = new URL(
        `/v1/ota/flag-definitions/${encodeURIComponent(this.options.projectSlug)}`,
        this.options.baseUrl,
      );
      if (this.options.channel) {
        url.searchParams.set("channel", this.options.channel);
      }

      const headers: Record<string, string> = {};
      if (this.options.apiKey) {
        headers["Authorization"] = `Bearer ${this.options.apiKey}`;
      }

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) return;

      const payload: FlagPayload = await res.json();
      const next = new Map<string, FlagDefinition>();
      for (const flag of payload.flags) {
        next.set(flag.key, flag);
      }
      this.flags = next;

      // Pre-populate flag states with default evaluations so health events
      // (especially app_launch) have flag_states even before components render.
      for (const [key, flag] of next) {
        if (!(key in this.lastKnownFlagStates)) {
          const result = evaluateFlag(flag, this.lastContext ?? {});
          if (result.value !== undefined) {
            this.lastKnownFlagStates[key] = result.value;
          }
        }
      }
    } catch (err) {
      console.warn("[AppDispatch] Failed to fetch flags:", err);
    }
  }

  /** Get all currently loaded flag definitions (for debugging). */
  getFlags(): ReadonlyMap<string, FlagDefinition> {
    return this.flags;
  }
}
