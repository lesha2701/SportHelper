import { apiRequest } from "./client";
import type { NotificationPreference } from "../types/notification";

export async function getNotificationPreferences(token: string): Promise<NotificationPreference[]> {
  return apiRequest<NotificationPreference[]>("/api/notifications/preferences", { token });
}

export async function setNotificationPreference(
  token: string,
  preference: NotificationPreference,
): Promise<NotificationPreference[]> {
  return apiRequest<NotificationPreference[]>("/api/notifications/preferences", {
    method: "PUT",
    token,
    body: { preferences: [preference] },
  });
}
