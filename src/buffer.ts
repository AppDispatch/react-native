import type { HealthEvent, HealthEventType } from "./types";

interface ErrorDetail {
  stackTrace?: string;
  errorName?: string;
  componentStack?: string;
  isFatal?: boolean;
  tags?: Record<string, string>;
}

interface BufferEntry {
  type: HealthEventType;
  name: string | undefined;
  message: string | undefined;
  count: number;
  flagStates: Record<string, unknown> | undefined;
  errorDetail: ErrorDetail | undefined;
}

/**
 * Accumulates health events, deduplicating by (type, name, message).
 * Count-increments on duplicate. Drain-and-reset on flush.
 */
export class EventBuffer {
  private entries: Map<string, BufferEntry> = new Map();

  private makeKey(
    type: HealthEventType,
    name: string | undefined,
    message: string | undefined,
  ): string {
    return `${type}::${name ?? ""}::${message ?? ""}`;
  }

  add(
    type: HealthEventType,
    name: string | undefined,
    message: string | undefined,
    count: number = 1,
    flagStates?: Record<string, unknown>,
    errorDetail?: ErrorDetail,
  ): void {
    const key = this.makeKey(type, name, message);
    const existing = this.entries.get(key);
    if (existing) {
      existing.count += count;
      if (flagStates) existing.flagStates = flagStates;
      // Keep the first error detail (has the original stack trace)
    } else {
      this.entries.set(key, {
        type,
        name,
        message,
        count,
        flagStates,
        errorDetail,
      });
    }
  }

  /** Drain all buffered events and reset. */
  drain(): HealthEvent[] {
    const events: HealthEvent[] = [];
    for (const entry of this.entries.values()) {
      const event: HealthEvent = {
        type: entry.type,
        count: entry.count,
      };
      if (entry.name) event.name = entry.name;
      if (entry.message) event.message = entry.message;
      if (entry.flagStates) event.flagStates = entry.flagStates;
      if (entry.errorDetail) {
        if (entry.errorDetail.stackTrace)
          event.stackTrace = entry.errorDetail.stackTrace;
        if (entry.errorDetail.errorName)
          event.errorName = entry.errorDetail.errorName;
        if (entry.errorDetail.componentStack)
          event.componentStack = entry.errorDetail.componentStack;
        if (entry.errorDetail.isFatal !== undefined)
          event.isFatal = entry.errorDetail.isFatal;
        if (entry.errorDetail.tags) event.tags = entry.errorDetail.tags;
      }
      events.push(event);
    }
    this.entries.clear();
    return events;
  }

  get size(): number {
    return this.entries.size;
  }
}
