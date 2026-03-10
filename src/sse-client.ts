// Dependency: react-native-sse (install via `npm install react-native-sse`)
// Metro provides require at runtime; declare for TS since we don't ship @types/node
declare const require: (id: string) => any;

import type { EvaluatedFlag } from "./types";
import type { CachedFlags } from "./cache";

export interface SSEClientOptions {
  baseUrl: string;
  projectSlug: string;
  channel?: string;
  deviceId: string;
  targetingKey?: string;
  apiKey?: string;
  onPut: (flags: CachedFlags) => void;
  onPatch: (key: string, flag: EvaluatedFlag) => void;
  onDelete: (key: string) => void;
  onError?: (error: any) => void;
}

export class SSEClient {
  private es: any = null;
  private readonly options: SSEClientOptions;
  private appStateSubscription: any = null;

  constructor(options: SSEClientOptions) {
    this.options = options;
    this.setupAppStateListener();
  }

  /** Open an SSE connection to the flag stream endpoint. */
  connect(): void {
    // Avoid duplicate connections
    if (this.es) return;

    try {
      const EventSource = require("react-native-sse").default;

      const url = new URL(
        `/v1/ota/flag-stream/${encodeURIComponent(this.options.projectSlug)}`,
        this.options.baseUrl,
      );
      if (this.options.channel)
        url.searchParams.set("channel", this.options.channel);
      url.searchParams.set("deviceId", this.options.deviceId);
      if (this.options.targetingKey)
        url.searchParams.set("targetingKey", this.options.targetingKey);

      const headers: Record<string, string> = {};
      if (this.options.apiKey)
        headers["Authorization"] = `Bearer ${this.options.apiKey}`;

      this.es = new EventSource(url.toString(), {
        headers,
        pollingInterval: 5000, // reconnect after 5s on disconnect
      });

      this.es.addEventListener("put", (event: any) => {
        try {
          const data = JSON.parse(event.data);
          this.options.onPut(data.flags);
        } catch (err) {
          if (this.options.onError) this.options.onError(err);
        }
      });

      this.es.addEventListener("patch", (event: any) => {
        try {
          const data = JSON.parse(event.data);
          this.options.onPatch(data.key, {
            value: data.value,
            variant: data.variant,
            reason: data.reason,
          });
        } catch (err) {
          if (this.options.onError) this.options.onError(err);
        }
      });

      this.es.addEventListener("delete", (event: any) => {
        try {
          const data = JSON.parse(event.data);
          this.options.onDelete(data.key);
        } catch (err) {
          if (this.options.onError) this.options.onError(err);
        }
      });

      this.es.addEventListener("error", (event: any) => {
        if (this.options.onError) this.options.onError(event);
      });
    } catch (err) {
      // react-native-sse not available
      if (this.options.onError) this.options.onError(err);
    }
  }

  /** Close the SSE connection without removing the AppState listener. */
  disconnect(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }

  /** Close the SSE connection and remove the AppState listener. */
  close(): void {
    this.disconnect();
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  /**
   * Set up AppState listener for background/foreground transitions.
   * Disconnects SSE when app backgrounds, reconnects when app returns to foreground.
   */
  private setupAppStateListener(): void {
    try {
      const { AppState } = require("react-native");
      this.appStateSubscription = AppState.addEventListener(
        "change",
        (state: string) => {
          if (state === "background" || state === "inactive") {
            this.disconnect();
          } else if (state === "active") {
            this.connect();
          }
        },
      );
    } catch {
      // AppState not available in all environments (e.g., testing)
    }
  }
}
