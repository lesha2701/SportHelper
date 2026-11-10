import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "sag_access_token";

// On a phone the session token lives only in the system secure storage. The web build (development in a
// browser) has no such storage, so sessionStorage stands in for it there.
let cached: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = Platform.OS === "web" ? (globalThis.sessionStorage?.getItem(KEY) ?? null) : await SecureStore.getItemAsync(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export async function setToken(token: string): Promise<void> {
  cached = token;
  if (Platform.OS === "web") globalThis.sessionStorage?.setItem(KEY, token);
  else await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  cached = null;
  try {
    if (Platform.OS === "web") globalThis.sessionStorage?.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* nothing to clear */
  }
}
