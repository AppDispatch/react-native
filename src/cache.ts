// Metro provides require at runtime; declare for TS since we don't ship @types/node
declare const require: (id: string) => any;

import type { EvaluatedFlag } from "./types";

const CACHE_KEY = "@appdispatch/flags";

export type CachedFlags = Record<string, EvaluatedFlag>;

/**
 * Load cached evaluated flags from AsyncStorage.
 * Returns null if no cache exists or on any error.
 */
export async function loadCachedFlags(): Promise<CachedFlags | null> {
  try {
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // AsyncStorage not available or parse failed -- start with empty cache
  }
  return null;
}

/**
 * Persist evaluated flags to AsyncStorage.
 * Silently catches errors (best-effort persistence).
 */
export async function persistFlags(flags: CachedFlags): Promise<void> {
  try {
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(flags));
  } catch {
    // Best-effort -- cache will be stale but in-memory map is always current
  }
}

/**
 * Clear persisted flag cache from AsyncStorage.
 * Silently catches errors.
 */
export async function clearFlags(): Promise<void> {
  try {
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // Silently ignore
  }
}
