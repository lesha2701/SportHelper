import Constants from "expo-constants";
import { Platform } from "react-native";
import { registerDevice, removeDevice } from "@/api/devices";

/** Push notifications on this phone (docs/push.md): ask permission, give the server the phone's FCM token, open the right
 * screen when a push is tapped. Everything is best effort, like restNotification.ts: with notifications off, on the web or
 * where the native part is missing (Expo Go has no push), the bell inside the app still shows everything. */

type NotificationsModule = typeof import("expo-notifications");
type NotificationResponse = import("expo-notifications").NotificationResponse;

let loaded: NotificationsModule | null | undefined;
let currentToken: string | null = null;

function notifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS !== "android") return (loaded = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require("expo-notifications") as NotificationsModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Asks for permission, reads the phone's token and tells the server. Resolves to the token, or null when push is unavailable. */
export async function registerForPush(): Promise<string | null> {
  const N = notifications();
  if (!N) return null;
  try {
    // The server names this channel in every push. It must exist before the first push arrives.
    await N.setNotificationChannelAsync("default", { name: "Уведомления", importance: N.AndroidImportance.HIGH });
    let status = (await N.getPermissionsAsync()).status;
    if (status !== "granted") status = (await N.requestPermissionsAsync()).status;
    if (status !== "granted") return null;
    const { data } = await N.getDevicePushTokenAsync();
    if (typeof data !== "string" || !data) return null;
    currentToken = data;
    await registerDevice(data, Constants.expoConfig?.version ?? null);
    return data;
  } catch {
    return null; // no Firebase in this build, offline, …: tried again at the next start
  }
}

/** The system replaced the token: the server must know the new one. Returns how to stop listening. */
export function watchTokenChanges(): () => void {
  const N = notifications();
  if (!N) return () => {};
  try {
    const sub = N.addPushTokenListener((token) => {
      if (typeof token.data !== "string" || !token.data) return;
      currentToken = token.data;
      void registerDevice(token.data, Constants.expoConfig?.version ?? null).catch(() => {});
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Calls `open` with the data of every tapped push, including the one that started the app. Returns how to stop listening. */
export function watchTaps(open: (data: unknown) => void): () => void {
  const N = notifications();
  if (!N) return () => {};
  try {
    const handled = new Set<string>();
    const handle = (response: NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handled.has(id)) return;
      handled.add(id);
      open(response.notification.request.content.data);
    };
    handle(N.getLastNotificationResponse());
    const sub = N.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** On sign-out, while the session still lives: this phone stops receiving this person's notifications. */
export async function unregisterFromPush(): Promise<void> {
  const token = currentToken;
  currentToken = null;
  if (!token) return;
  try {
    await removeDevice(token);
  } catch {
    /* offline: the server forgets the token when the next person signs in on this phone, or when the system reports it dead */
  }
}
