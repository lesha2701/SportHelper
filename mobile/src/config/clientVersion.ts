import Constants from "expo-constants";
import { Platform } from "react-native";

export interface UpdateNotice {
  required: boolean;
  url: string | null;
}

type Listener = (notice: UpdateNotice) => void;
const listeners = new Set<Listener>();
const version = Constants.expoConfig?.version;

export const androidClient = Platform.OS === "android" && typeof version === "string" && /^\d+(\.\d+)*$/.test(version);
export const clientVersionHeaders: Record<string, string> = androidClient && version
  ? { "X-Client-Platform": "android", "X-Client-Version": version }
  : {};

export function onUpdateRequired(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requireClientUpdate(url: string | null) {
  if (!androidClient) return;
  for (const listener of listeners) listener({ required: true, url });
}
