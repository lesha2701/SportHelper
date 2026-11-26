/** Team tools are temporarily outside the public marketplace experience. */
export const TEAM_FEATURES_VISIBLE = false;

export const isVisibleCalendarEvent = (event: { type: string; teamId?: string | null }) =>
  TEAM_FEATURES_VISIBLE || (event.type !== "match" && event.type !== "task_deadline" && !event.teamId);

export const isVisibleSearchResult = (result: { type: string; teamId?: string | null }) =>
  TEAM_FEATURES_VISIBLE || !(["team", "player", "match", "task"].includes(result.type) || result.teamId);

export const isVisibleNotification = (notification: { category: string; entityType?: string }) =>
  TEAM_FEATURES_VISIBLE || !(["task_deadline", "new_task", "new_match", "new_training", "chat_team"].includes(notification.category)
    || ["team", "match", "task"].includes(notification.entityType ?? ""));
