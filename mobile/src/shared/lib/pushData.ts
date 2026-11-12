import { routeForNotification, type AppRoute } from "./notificationRoute";

/** The screen a tapped push opens. The server puts `category`, `entity_type` and `entity_id` into the push (docs/push.md);
 * a push without them, or about something with no screen, just opens the app. */
export function routeForPushData(data: unknown): AppRoute | null {
  if (typeof data !== "object" || data === null) return null;
  const { category, entity_type: entityType, entity_id: entityId } = data as Record<string, unknown>;
  if (typeof entityType !== "string" || typeof entityId !== "string" || !entityId) return null;
  return routeForNotification(entityType, entityId, typeof category === "string" ? category : undefined);
}
