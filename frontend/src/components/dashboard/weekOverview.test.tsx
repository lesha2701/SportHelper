import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../../types/calendar";
import { WeekOverview } from "./WeekOverview";

const navigateApp = vi.fn();
vi.mock("../../appNav", () => ({ navigateApp: (target: unknown) => navigateApp(target) }));

const TODAY = "2026-10-07";
const weekDays = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 5 + i));

const event = (id: string, date: string, time: string | null, title: string): CalendarEvent => ({
  id,
  type: "training",
  date,
  time,
  title,
  teamId: null,
  teamName: null,
  status: "scheduled",
});

function setPhone(isPhone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isPhone && query.includes("max-width: 640px"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => navigateApp.mockReset());
afterEach(cleanup);

describe("«Эта неделя» on the home tab", () => {
  it("on a desktop keeps the 7-day grid", () => {
    setPhone(false);
    render(<WeekOverview weekDays={weekDays} events={[event("e1", TODAY, "18:00:00", "Тренировка")]} today={TODAY} onOpenEvent={() => {}} />);

    expect(screen.getByText("Эта неделя")).not.toBeNull();
    expect(screen.getAllByText("Пн").length).toBe(1);
    expect(screen.queryByRole("button", { name: "Открыть календарь" })).toBeNull();
  });

  it("on a phone shows just what today holds and a button into the calendar", () => {
    setPhone(true);
    const onOpen = vi.fn();
    const events = [event("e1", TODAY, "18:00:00", "Силовая"), event("e2", TODAY, "20:30:00", "Растяжка"), event("e3", "2026-10-09", "10:00:00", "Матч")];
    render(<WeekOverview weekDays={weekDays} events={events} today={TODAY} onOpenEvent={onOpen} />);

    expect(screen.queryByText("Эта неделя")).toBeNull();
    expect(screen.queryByText("Пн")).toBeNull(); // no squeezed week columns
    expect(screen.getByText("Сегодня вас ждёт: 2 события.")).not.toBeNull();
    expect(screen.queryByText("Матч")).toBeNull(); // other days are the calendar's job

    fireEvent.click(screen.getByText("Силовая"));
    expect(onOpen).toHaveBeenCalledWith(events[0]);

    fireEvent.click(screen.getByRole("button", { name: "Открыть календарь" }));
    expect(navigateApp).toHaveBeenCalledWith({ kind: "tab", tab: "calendar" });
  });

  it("on a phone with an empty day mentions the next event", async () => {
    setPhone(true);
    render(<WeekOverview weekDays={weekDays} events={[event("e3", "2026-10-09", "10:00:00", "Матч")]} today={TODAY} onOpenEvent={() => {}} />);
    await act(async () => {});

    expect(screen.getByText(/Сегодня событий нет\./)).not.toBeNull();
    expect(screen.getByText(/10:00 — Матч/)).not.toBeNull();
  });
});
