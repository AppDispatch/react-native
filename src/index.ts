export { AppDispatch } from "./appdispatch";
export type { AppDispatchInstance } from "./appdispatch";
export { AppDispatchProvider } from "./provider-component";
export { useOTAUpdates } from "./use-ota-updates";
export { getDeviceId } from "./device-id";
export type { AppDispatchOptions } from "./types";

// Re-export OpenFeature hooks so customers don't need to install @openfeature/react-sdk separately
export {
  useBooleanFlagValue,
  useStringFlagValue,
  useNumberFlagValue,
  useObjectFlagValue,
  useBooleanFlagDetails,
  useStringFlagDetails,
  useNumberFlagDetails,
  useObjectFlagDetails,
} from "@openfeature/react-sdk";
