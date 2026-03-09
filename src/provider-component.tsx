import React, { useEffect } from "react";
import { OpenFeatureProvider } from "@openfeature/react-sdk";
import { AppDispatch } from "./appdispatch";

/**
 * Wraps OpenFeatureProvider and manages the health reporter lifecycle.
 * Starts health monitoring on mount, stops on unmount.
 *
 * ```tsx
 * <AppDispatchProvider>
 *   <App />
 * </AppDispatchProvider>
 * ```
 */
export function AppDispatchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    AppDispatch.instance.start();
    return () => {
      AppDispatch.instance.stop();
    };
  }, []);

  return <OpenFeatureProvider>{children}</OpenFeatureProvider>;
}
