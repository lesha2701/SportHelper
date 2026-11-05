import { apiRequest } from "./client";
import { mapNotificationItemDto, type NotificationItem, type NotificationItemDto, type NotificationPreference } from "@/shared/types/notification";

export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  return apiRequest<NotificationPreference[]>("/api/notifications/preferences");
}

export async function setNotificationPreference(
  preference: NotificationPreference,
): Promise<NotificationPreference[]> {
  return apiRequest<NotificationPreference[]>("/api/notifications/preferences", {
    method: "PUT", silent: true,
    body: { preferences: [preference] },
  });
}

export async function listNotifications(): Promise<NotificationItem[]> {
  const dtos = await apiRequest<NotificationItemDto[]>("/api/notifications");
  return dtos.map(mapNotificationItemDto);
}

export async function markNotificationRead(notificationId: string): Promise<NotificationItem> {
  const dto = await apiRequest<NotificationItemDto>(`/api/notifications/${notificationId}/read`, {
    method: "POST", silent: true,
  });
  return mapNotificationItemDto(dto);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiRequest(`/api/notifications/read-all`, { method: "POST", silent: true });
}
