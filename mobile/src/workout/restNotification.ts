import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** A system notification when the rest between sets ends, so it rings even if the phone is locked or the app is in the
 * background. Everything here is best effort: with notifications off (or on the web) the in-app timer still works. */

const CHANNEL = "workout-rest";
let ready: Promise<boolean> | null = null;

function setup(): Promise<boolean> {
  ready ??= (async () => {
    if (Platform.OS === "web") return false;
    try {
      Notifications.setNotificationHandler({
        // While the app is open the in-app timer vibrates; the system notification is for when it is in the background.
        handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
      });
      if (Platform.OS === "android") {
        // eslint-disable-next-line import/namespace -- the enum exists in the package (it type-checks); the plugin cannot see through its re-exports
        await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Отдых между подходами", importance: Notifications.AndroidImportance.HIGH });
      }
      const current = await Notifications.getPermissionsAsync();
      if (current.status === "granted") return true;
      return (await Notifications.requestPermissionsAsync()).status === "granted";
    } catch {
      return false;
    }
  })();
  return ready;
}

/** Schedules "rest is over" after `seconds`; returns an id to cancel it with, or null when notifications are unavailable. */
export async function scheduleRestEnd(seconds: number): Promise<string | null> {
  if (!(await setup()) || seconds < 1) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title: "Отдых закончился", body: "Пора на следующий подход." },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.ceil(seconds), channelId: CHANNEL },
    });
  } catch {
    return null;
  }
}

export async function cancelRestEnd(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* already fired or gone */
  }
}
