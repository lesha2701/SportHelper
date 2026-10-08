import type { NotificationCategory } from "./types/notification";
import type { Training } from "./types/training";

export type OverlayBase =
  | { kind: "team"; teamId: string }
  | { kind: "training-create" }
  | { kind: "training-edit"; training: Training }
  | { kind: "training-detail"; trainingId: string }
  | { kind: "match-detail"; matchId: string }
  | { kind: "task-detail"; taskId: string }
  | { kind: "my-stats" }
  | { kind: "notifications" }
  | { kind: "incoming-bookings"; focusBookingId?: string }
  | { kind: "my-bookings"; reviewBookingId?: string; focusBookingId?: string };

/** `backTo` is where "Назад" returns: an overlay opened from the notification
 * list goes back to that list, not to whatever tab happened to be underneath. */
export type Overlay = (OverlayBase & { backTo?: OverlayBase }) | null;

/** Where a notification's "Открыть в приложении" button (Telegram) or its
 * row on the in-app bell screen should navigate to. booking_requested (the
 * coach's inbox) and booking_decided (the athlete's own bookings) share
 * entity_type "booking" but need different screens, which is why this
 * switches on `category` rather than `entity_type`. */
export function notificationToOverlay(category: NotificationCategory, entityId: string): Overlay {
  switch (category) {
    case "training_reminder":
    case "new_training":
      return { kind: "training-detail", trainingId: entityId };
    case "new_match":
      return { kind: "match-detail", matchId: entityId };
    case "task_deadline":
    case "new_task":
      return { kind: "task-detail", taskId: entityId };
    case "booking_requested":
      // entityId is the booking: the inbox opens on that very request.
      return { kind: "incoming-bookings", focusBookingId: entityId };
    case "booking_decided":
      // Confirmed → straight to its training; otherwise the list, on that booking.
      return { kind: "my-bookings", focusBookingId: entityId };
    case "training_nudge":
      // The "time to train" nudge: straight to planning a training. entityId is just the user's own id.
      return { kind: "training-create" };
    case "review_requested":
      // entityId is the booking: open "Мои брони" with its review form ready.
      return { kind: "my-bookings", reviewBookingId: entityId };
    default:
      return null;
  }
}

