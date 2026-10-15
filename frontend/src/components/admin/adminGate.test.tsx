import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDashboard, getAdminSession } from "../../api/admin";
import { ApiError } from "../../api/client";
import AdminApp from "./AdminApp";

vi.mock("../../api/admin", () => ({ getAdminSession: vi.fn(), getAdminDashboard: vi.fn(), listAdminComplaints: vi.fn(() => Promise.resolve({ total: 0, limit: 1, offset: 0, items: [] })) }));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ state: { status: "ready", user: { id: "me", email: "boss@example.com", isAdmin: true } } }),
}));
// The enrolment/code form has its own tests; here only which screen the gate shows matters.
vi.mock("../profile/AccountSecurity", () => ({ MfaSection: () => <div>MFA FORM</div> }));

const sessionMock = vi.mocked(getAdminSession);

beforeEach(() => {
  sessionMock.mockReset();
  vi.mocked(getAdminDashboard).mockReset();
  vi.mocked(getAdminDashboard).mockResolvedValue({
    users: { total: 12, newToday: 1, new7d: 3, new30d: 9, players: 8, coaches: 2, banned: 1 },
    activity: { dau: 2, wau: 5, mau: 9, trackingSince: "2026-10-15" },
    trainings: { total: 40, active: 10, upcoming: 6, completed: 25 },
    bookings: { total: 4, confirmed: 3, upcoming: 1 },
    moderation: { newComplaints: 2, contentPending: 1 },
    registrations: [], activeUsers: [], trainingsCreated: [], bookingsCreated: [],
  });
  window.history.replaceState(null, "", "/admin");
});
afterEach(cleanup);

const open = async () => {
  render(<AdminApp />);
  await act(async () => {});
};

describe("the administration gate", () => {
  it("shows no panel and no data while the second factor is not set up", async () => {
    sessionMock.mockResolvedValue({ isAdmin: true, mfaEnabled: false, mfaVerified: false, mfaRecent: false });

    await open();

    expect(screen.getByText(/включите двухфакторную защиту/)).toBeTruthy();
    expect(screen.getByText("MFA FORM")).toBeTruthy();
    expect(getAdminDashboard).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("asks for the code of this session before opening anything", async () => {
    sessionMock.mockResolvedValue({ isAdmin: true, mfaEnabled: true, mfaVerified: false, mfaRecent: false });

    await open();

    expect(screen.getByText(/Введите код из приложения/)).toBeTruthy();
    expect(getAdminDashboard).not.toHaveBeenCalled();
  });

  it("opens the panel once the server confirms access and the code", async () => {
    sessionMock.mockResolvedValue({ isAdmin: true, mfaEnabled: true, mfaVerified: true, mfaRecent: true });

    await open();

    expect(screen.getByRole("navigation", { name: "Разделы администрирования" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /На сайт/ }).getAttribute("href")).toBe("/");
    expect(screen.getByText("boss@example.com")).toBeTruthy();
    expect(getAdminDashboard).toHaveBeenCalled();
  });

  it("shows a refusal - and no data - when the server says the access is gone", async () => {
    sessionMock.mockRejectedValue(new ApiError(403, "forbidden", "administrator access required"));

    await open();

    expect(screen.getByText("Доступ закрыт")).toBeTruthy();
    expect(getAdminDashboard).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("does not open the panel when the check itself fails", async () => {
    sessionMock.mockRejectedValue(new ApiError(0, "network_error", "Не удалось связаться с сервером"));

    await open();

    expect(screen.getByText("Не удалось проверить доступ")).toBeTruthy();
    expect(getAdminDashboard).not.toHaveBeenCalled();
  });

  it("sends the administrator back to the gate when a later request is refused", async () => {
    sessionMock.mockResolvedValueOnce({ isAdmin: true, mfaEnabled: true, mfaVerified: true, mfaRecent: true });
    vi.mocked(getAdminDashboard).mockRejectedValue(new ApiError(403, "mfa_required", "confirm your two-factor code to continue"));
    sessionMock.mockResolvedValueOnce({ isAdmin: true, mfaEnabled: true, mfaVerified: false, mfaRecent: false });

    await open();
    await act(async () => {});

    expect(screen.getByText(/Введите код из приложения/)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Разделы администрирования" })).toBeNull();
  });
});
