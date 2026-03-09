/**
 * Snapshot the current flag evaluation states.
 * Called at event time to capture which flags are active.
 */
export function snapshotFlagStates(
  provider: (() => Record<string, unknown>) | null,
): Record<string, unknown> | undefined {
  if (!provider) return undefined;
  try {
    const states = provider();
    if (states && Object.keys(states).length > 0) return states;
  } catch {
    // Provider threw — don't let correlation break event capture
  }
  return undefined;
}
