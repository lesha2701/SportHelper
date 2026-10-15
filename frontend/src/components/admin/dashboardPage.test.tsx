import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDashboard, type AdminDashboard, type DayCount } from "../../api/admin";
import { DashboardPage } from "./DashboardPage";

vi.mock("../../api/admin", () => ({ getAdminDashboard: vi.fn() }));
const dashboardMock = vi.mocked(getAdminDashboard);

const days = (counts: number[]): DayCount[] => counts.map((count, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, count }));

function dashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    users: { total: 1234, newToday: 5, new7d: 40, new30d: 160, players: 900, coaches: 120, banned: 3 },
    activity: { dau: 21, wau: 88, mau: 301, trackingSince: "2026-10-01" },
    trainings: { total: 777, active: 60, upcoming: 41, completed: 700 },
    bookings: { total: 90, confirmed: 70, upcoming: 12 },
    moderation: { newComplaints: 5, contentPending: 3 },
    registrations: days([0, 2, 1]),
    activeUsers: days([4, 5, 6]),
    trainingsCreated: days([0, 0, 0]),
    bookingsCreated: days([1, 0, 2]),
    ...overrides,
  };
}

beforeEach(() => dashboardMock.mockReset());
afterEach(cleanup);

const open = async () => {
  render(<DashboardPage />);
  await act(async () => {});
};

describe("the dashboard", () => {
  it("shows the real figures it was given", async () => {
    dashboardMock.mockResolvedValue(dashboard());

    await open();

    expect(screen.getByText("Всего пользователей").previousSibling?.textContent).toBe("1 234");
    expect(screen.getByText(/DAU/).previousSibling?.textContent).toBe("21");
    expect(screen.getByText(/WAU/).previousSibling?.textContent).toBe("88");
    expect(screen.getByText(/MAU/).previousSibling?.textContent).toBe("301");
    expect(screen.getByText("Предстоящие").previousSibling?.textContent).toBe("41");
    expect(screen.getByText(/Учёт ведётся с 01\.10\.2026/)).toBeTruthy();
  });

  it("draws a chart where there is data and a calm empty state where there is none", async () => {
    dashboardMock.mockResolvedValue(dashboard());

    await open();

    expect(screen.getByRole("img", { name: "Регистрации по дням" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Записи по дням" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Созданные тренировки по дням" })).toBeNull();
    expect(screen.getByText("Пока нет данных за последние 30 дней")).toBeTruthy();
  });

  it("says activity tracking has just begun instead of showing made-up zeros as history", async () => {
    dashboardMock.mockResolvedValue(
      dashboard({ activity: { dau: 0, wau: 0, mau: 0, trackingSince: null }, activeUsers: days([0, 0, 0]) }),
    );

    await open();

    expect(screen.getByText(/Учёт активности только начался/)).toBeTruthy();
    expect(screen.getByText(/Пока нет данных: учёт активности/)).toBeTruthy();
  });

  it("shows an error with a retry instead of an empty page", async () => {
    dashboardMock.mockRejectedValueOnce(new Error("boom"));
    dashboardMock.mockResolvedValueOnce(dashboard());

    await open();
    expect(screen.getByRole("alert").textContent).toContain("Не удалось выполнить запрос");

    await act(async () => void screen.getByRole("button", { name: "Повторить" }).click());
    expect(screen.getByText("Всего пользователей")).toBeTruthy();
  });
});
