/** A tiny navigation bus so a screen (or a toast action) can send the user to
 * another part of the app without knowing how the shell is laid out: the
 * Workspace subscribes and maps these to its tabs/overlays. Same idea as the
 * toast store — usable from anywhere, no React context needed. */

export type AppTab = "dashboard" | "teams" | "calendar" | "coaches";

export type AppTarget =
  | { kind: "tab"; tab: AppTab }
  | { kind: "training"; trainingId: string }
  | { kind: "training-create" }
  | { kind: "my-bookings" }
  | { kind: "incoming-bookings" };

type Listener = (target: AppTarget) => void;

const listeners = new Set<Listener>();

export function navigateApp(target: AppTarget): void {
  listeners.forEach((listener) => listener(target));
}

export function subscribeAppNav(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
