import type { HealthEvent, HealthEventType } from "./types";

interface BufferEntry {
  type: HealthEventType;
  name: string | undefined;
  message: string | undefined;
  count: number;
  flagStates: Record<string, unknown> | undefined;
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
  ): void {
    const key = this.makeKey(type, name, message);
    const existing = this.entries.get(key);
    if (existing) {
      existing.count += count;
      if (flagStates) existing.flagStates = flagStates;
    } else {
      this.entries.set(key, { type, name, message, count, flagStates });
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
      events.push(event);
    }
    this.entries.clear();
    return events;
  }

  get size(): number {
    return this.entries.size;
  }
}
