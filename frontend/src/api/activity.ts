import { apiRequest } from "./client";

/** "This signed-in person is using the site" - at most once in a while, see useActivityPing. */
export async function sendActivityPing(): Promise<void> {
  await apiRequest("/api/activity", { method: "POST", silent: true });
}
