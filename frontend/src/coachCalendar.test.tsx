import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "./types/calendar";
import { CoachTabContent } from "./Workspace";

// What matters here is what the trainer's calendar is given, not how it draws: a stand-in that exposes its two callbacks.
vi.mock("./components/CalendarScreen", () => ({
  CalendarScreen: ({ onOpenEvent, onCreateTraining }: { onOpenEvent?: (e: CalendarEvent) => void; onCreateTraining?: () => void }) => (
    <div>
      <button type="button" onClick={() => onOpenEvent?.({ type: "training", id: "t1" } as CalendarEvent)} disabled={!onOpenEvent}>
        открыть событие
      </button>
      <button type="button" onClick={() => onCreateTraining?.()} disabled={!onCreateTraining}>
        создать тренировку
      </button>
    </div>
  ),
}));

afterEach(cleanup);

const props = {
  initialCoachUserId: null,
  marketplaceStart: null,
  token: "t",
  userId: "me",
  onOpenMyStats: () => {},
  onOpenTeam: () => {},
  onOpenNotifications: () => {},
  unreadNotifications: 0,
  startProfileInSettings: false,
  onProfileSettingsOpened: () => {},
};

describe("the trainer's calendar", () => {
  it("opens a training when the trainer clicks it, like the player's calendar does", () => {
    const onOpenEvent = vi.fn();
    render(<CoachTabContent {...props} tab="calendar" onOpenEvent={onOpenEvent} onCreateTraining={() => {}} />);

    const open = screen.getByRole("button", { name: "открыть событие" }) as HTMLButtonElement;
    expect(open.disabled).toBe(false); // the calendar was given a handler at all
    fireEvent.click(open);

    expect(onOpenEvent).toHaveBeenCalledWith({ type: "training", id: "t1" });
  });

  it("lets the trainer create a training from the calendar too", () => {
    const onCreateTraining = vi.fn();
    render(<CoachTabContent {...props} tab="calendar" onOpenEvent={() => {}} onCreateTraining={onCreateTraining} />);

    fireEvent.click(screen.getByRole("button", { name: "создать тренировку" }));

    expect(onCreateTraining).toHaveBeenCalledTimes(1);
  });
});
