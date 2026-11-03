import type { Overlay } from "../overlay";

/** Where the person was in the app, kept for the browser tab so a page reload lands on the same screen. */
export interface SavedView<CoachTab extends string, PlayerTab extends string> {
  coachTab?: CoachTab;
  playerTab?: PlayerTab;
  overlay?: Overlay;
}

const key = (userId: string) => `sag-view:${userId}`;

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function loadView<CoachTab extends string, PlayerTab extends string>(
  userId: string | null,
  coachTabs: readonly CoachTab[],
  playerTabs: readonly PlayerTab[],
): SavedView<CoachTab, PlayerTab> {
  if (!userId) return {};
  try {
    const raw = window.sessionStorage.getItem(key(userId));
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, unknown>;
    const view: SavedView<CoachTab, PlayerTab> = {};
    if (isOneOf(data.coachTab, coachTabs)) view.coachTab = data.coachTab;
    if (isOneOf(data.playerTab, playerTabs)) view.playerTab = data.playerTab;
    const overlay = data.overlay as { kind?: unknown } | null | undefined;
    if (overlay && typeof overlay.kind === "string") view.overlay = overlay as Overlay;
    return view;
  } catch {
    return {}; // storage blocked or the saved text is not ours: start on the main screen
  }
}

export function saveView<CoachTab extends string, PlayerTab extends string>(
  userId: string | null,
  view: SavedView<CoachTab, PlayerTab>,
): void {
  if (!userId) return;
  try {
    // An edit form holds the whole training object; after a reload it is better to go back than to show stale data.
    const overlay = view.overlay?.kind === "training-edit" ? null : (view.overlay ?? null);
    window.sessionStorage.setItem(key(userId), JSON.stringify({ ...view, overlay }));
  } catch {
    /* private mode or full storage: the reload simply starts from the main screen */
  }
}
