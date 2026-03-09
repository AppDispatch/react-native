/**
 * React Native error auto-capture via ErrorUtils.
 * Chains onto the existing global handler (does not replace it).
 * No-ops silently in environments where ErrorUtils is unavailable.
 */

// React Native global — not typed in standard TS libs
declare const ErrorUtils:
  | {
      getGlobalHandler(): (error: Error, isFatal?: boolean) => void;
      setGlobalHandler(
        handler: (error: Error, isFatal?: boolean) => void,
      ): void;
    }
  | undefined;

/**
 * Install a global JS error handler that chains with the existing one.
 * Returns a teardown function that restores the original handler.
 */
export function installErrorHandler(
  onError: (message: string, isFatal: boolean) => void,
): (() => void) | null {
  if (typeof ErrorUtils === "undefined") return null;

  const originalHandler = ErrorUtils.getGlobalHandler();

  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    try {
      const message = error?.message || error?.toString() || "Unknown error";
      onError(message, isFatal ?? false);
    } catch {
      // Never let our handler break the app
    }

    if (originalHandler) {
      originalHandler(error, isFatal);
    }
  });

  return () => {
    ErrorUtils.setGlobalHandler(originalHandler);
  };
}

// Metro provides require at runtime; declare it for TS since we don't ship @types/node
declare const require: (id: string) => any;

/**
 * Track app launches via AppState transitions.
 * Fires on initial start() and on background → active transitions.
 * Returns a teardown function.
 */
export function installAppLaunchTracker(
  onLaunch: () => void,
): (() => void) | null {
  try {
    const { AppState } = require("react-native") as any;
    if (!AppState?.addEventListener) return null;

    let lastState: string = AppState.currentState ?? "unknown";

    // Record initial launch
    onLaunch();

    const subscription = AppState.addEventListener(
      "change",
      (nextState: string) => {
        if (
          (lastState === "background" || lastState === "inactive") &&
          nextState === "active"
        ) {
          onLaunch();
        }
        lastState = nextState;
      },
    );

    return () => {
      subscription?.remove?.();
    };
  } catch {
    return null;
  }
}
