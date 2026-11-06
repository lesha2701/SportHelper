import { Platform } from "react-native";

/** A system notification when the rest between sets ends, so it rings even if the phone is locked or the app is in the
 * background. Everything here is best effort: with notifications off, on the web, or where the native module is missing
 * (Expo Go does not ship every one), the in-app timer still works and nothing here may break the app. */

type NotificationsModule = typeof import("expo-notifications");

const CHANNEL = "workout-rest";
let loaded: NotificationsModule | null | undefined;
let ready: Promise<NotificationsModule | null> | null = null;

/** The notifications module, or null when it cannot be loaded. It is required lazily and inside try/catch: merely
 * importing it throws in a runtime that lacks its native part, which would crash the whole app at start. */
function notifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS === "web") return (loaded = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require("expo-notifications") as NotificationsModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

function setup(): Promise<NotificationsModule | null> {
  ready ??= (async () => {
    const N = notifications();
    if (!N) return null;
    try {
      N.setNotificationHandler({
        // While the app is open the in-app timer vibrates; the system notification is for when it is in the background.
        handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
      });
      if (Platform.OS === "android") {
        await N.setNotificationChannelAsync(CHANNEL, { name: "Отдых между подходами", importance: N.AndroidImportance.HIGH });
      }
      const current = await N.getPermissionsAsync();
      if (current.status === "granted") return N;
      return (await N.requestPermissionsAsync()).status === "granted" ? N : null;
    } catch {
      return null;
    }
  })();
  return ready;
}

/** Schedules "rest is over" after `seconds`; returns an id to cancel it with, or null when notifications are unavailable. */
export async function scheduleRestEnd(seconds: number): Promise<string | null> {
  const N = await setup();
  if (!N || seconds < 1) return null;
  try {
    return await N.scheduleNotificationAsync({
      content: { title: "Отдых закончился", body: "Пора на следующий подход." },
      trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.ceil(seconds), channelId: CHANNEL },
    });
  } catch {
    return null;
  }
}

export async function cancelRestEnd(id: string | null): Promise<void> {
  const N = notifications();
  if (!id || !N) return;
  try {
    await N.cancelScheduledNotificationAsync(id);
  } catch {
    /* already fired or gone */
  }
}
