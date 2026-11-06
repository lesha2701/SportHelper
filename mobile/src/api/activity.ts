import { apiRequest } from "./client";

/** "This signed-in person is using the app" — for the admin statistics (DAU/WAU/MAU); see useActivityPing. */
export async function sendActivityPing(): Promise<void> {
  await apiRequest("/api/activity", { method: "POST", silent: true });
}
