/** Where a notification leads, by what it is about. null: it is only to be read. */
export type AppRoute =
  | { pathname: "/training/[id]" | "/match/[id]" | "/task/[id]"; params: { id: string } }
  | { pathname: "/bookings" | "/finance" }
  | { pathname: "/chat/[kind]/[id]"; params: { kind: "booking" | "team"; id: string } };

/** `category` matters for chat messages: they share the entity type "booking" / "team" with other notifications but open the chat. */
export function routeForNotification(entityType: string, entityId: string, category?: string): AppRoute | null {
  if (category === "chat_booking") return { pathname: "/chat/[kind]/[id]", params: { kind: "booking", id: entityId } };
  if (category === "chat_team") return { pathname: "/chat/[kind]/[id]", params: { kind: "team", id: entityId } };
  switch (entityType) {
    case "training":
      return { pathname: "/training/[id]", params: { id: entityId } };
    case "match":
      return { pathname: "/match/[id]", params: { id: entityId } };
    case "task":
      return { pathname: "/task/[id]", params: { id: entityId } };
    case "booking":
    case "payment":
      return { pathname: "/bookings" };
    case "earning":
    case "withdrawal":
      return { pathname: "/finance" };
    default:
      return null;
  }
}
