// Metro provides require at runtime; declare for TS since we don't ship @types/node
declare const require: (id: string) => any;

/**
 * Generate a random device ID.
 * Uses crypto.randomUUID (available in Hermes) with a manual fallback.
 */
function generateDeviceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

/**
 * Get or create a persisted device ID using AsyncStorage.
 * Falls back to an in-memory ID if AsyncStorage is unavailable.
 */
let cachedDeviceId: string | null = null;
const DEVICE_ID_KEY = "@appdispatch/device_id";

export async function getDeviceId(providedId?: string): Promise<string> {
  if (providedId) return providedId;
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
    const id = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    cachedDeviceId = id;
    return id;
  } catch {
    // AsyncStorage not available — use in-memory ID (persists for session)
    if (!cachedDeviceId) {
      cachedDeviceId = generateDeviceId();
    }
    return cachedDeviceId;
  }
}
