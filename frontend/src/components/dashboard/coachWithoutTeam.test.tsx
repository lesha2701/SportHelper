import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCoachPendingBookings } from "../../api/bookings";
import { getCalendar } from "../../api/calendar";
import { listMyTeams } from "../../api/teams";
import type { CalendarEvent } from "../../types/calendar";
import { CoachDashboard } from "./CoachDashboard";

vi.mock("../../api/teams", () => ({ listMyTeams: vi.fn() }));
vi.mock("../../api/calendar", () => ({ getCalendar: vi.fn() }));
vi.mock("../../api/bookings", () => ({ listCoachPendingBookings: vi.fn() }));
vi.mock("../../api/stats", () => ({ getTeamStats: vi.fn() }));
vi.mock("../../api/matches", () => ({ listTeamMatches: vi.fn() }));

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const event = (id: string, date: string): CalendarEvent =>
  ({ id, type: "training", title: `Занятие ${id}`, date, time: "23:00:00", teamName: null, status: "scheduled" }) as unknown as CalendarEvent;

describe("a coach who is not in a team", () => {
  it("sees the nearest event, the week and their numbers instead of an empty screen", async () => {
    vi.mocked(listMyTeams).mockResolvedValue([]);
    vi.mocked(getCalendar).mockResolvedValue([event("a", inDays(1)), event("b", inDays(10))]);
    vi.mocked(listCoachPendingBookings).mockResolvedValue([{}, {}, {}] as never);
    render(<CoachDashboard token="t" onOpenEvent={() => {}} onOpenTeam={() => {}} onCreateTraining={() => {}} />);

    expect((await screen.findAllByText("Занятие a")).length).toBeGreaterThan(0); // the nearest event (and the week grid)
    expect(screen.getByText("Ближайшее событие")).toBeTruthy();
    expect(screen.getByText("Эта неделя")).toBeTruthy();
    expect(screen.getByText("Событий в ближайшие 2 недели")).toBeTruthy();
    expect(await screen.findByText("3")).toBeTruthy(); // new requests
    expect(screen.getByRole("button", { name: "Создать команду" })).toBeTruthy();
    expect(screen.queryByText("Пока нет команд")).toBeNull();
  });

  it("still shows the rest when the requests cannot be loaded", async () => {
    vi.mocked(listMyTeams).mockResolvedValue([]);
    vi.mocked(getCalendar).mockResolvedValue([]);
    vi.mocked(listCoachPendingBookings).mockRejectedValue(new Error("offline"));
    render(<CoachDashboard token="t" onOpenEvent={() => {}} onOpenTeam={() => {}} onCreateTraining={() => {}} />);

    expect(await screen.findByText("Нет ближайших событий")).toBeTruthy();
    expect(screen.getByText("Новых заявок")).toBeTruthy();
  });
});
