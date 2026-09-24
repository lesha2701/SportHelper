import { apiRequest } from "./client";
import { mapNotificationItemDto, type NotificationItem, type NotificationItemDto, type NotificationPreference } from "../types/notification";

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

export async function listNotifications(token: string): Promise<NotificationItem[]> {
  const dtos = await apiRequest<NotificationItemDto[]>("/api/notifications", { token });
  return dtos.map(mapNotificationItemDto);
}

export async function markNotificationRead(token: string, notificationId: string): Promise<NotificationItem> {
  const dto = await apiRequest<NotificationItemDto>(`/api/notifications/${notificationId}/read`, {
    method: "POST",
    token,
  });
  return mapNotificationItemDto(dto);
}

export async function markAllNotificationsRead(token: string): Promise<void> {
  await apiRequest(`/api/notifications/read-all`, { method: "POST", token });
}
