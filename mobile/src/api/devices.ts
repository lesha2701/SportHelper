import { apiRequest } from "./client";

/** Tells the server which phone to push to (docs/push.md). Idempotent; silent: a failure is retried at the next start. */
export async function registerDevice(token: string, appVersion: string | null): Promise<void> {
  await apiRequest("/api/devices", { method: "PUT", silent: true, body: { platform: "android", token, app_version: appVersion } });
}

/** On sign-out, while the session still lives: this phone stops receiving this person's notifications. */
export async function removeDevice(token: string): Promise<void> {
  await apiRequest("/api/devices/remove", { method: "POST", silent: true, body: { token } });
}
