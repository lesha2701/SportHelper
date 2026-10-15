import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminOverview, getAdminSession } from "../../api/admin";
import { ApiError } from "../../api/client";
import AdminApp from "./AdminApp";

vi.mock("../../api/admin", () => ({ getAdminSession: vi.fn(), getAdminOverview: vi.fn() }));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ state: { status: "ready", user: { id: "me", email: "boss@example.com", isAdmin: true } } }),
}));
// The enrolment/code form has its own tests; here only which screen the gate shows matters.
vi.mock("../profile/AccountSecurity", () => ({ MfaSection: () => <div>MFA FORM</div> }));

const sessionMock = vi.mocked(getAdminSession);

beforeEach(() => {
  sessionMock.mockReset();
  vi.mocked(getAdminOverview).mockReset();
  vi.mocked(getAdminOverview).mockResolvedValue({
    totalUsers: 12, bannedUsers: 1, totalTeams: 3, totalTrainings: 40, totalMatches: 5, totalTasks: 7, pendingNotifications: 0,
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
    expect(getAdminOverview).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("asks for the code of this session before opening anything", async () => {
    sessionMock.mockResolvedValue({ isAdmin: true, mfaEnabled: true, mfaVerified: false, mfaRecent: false });

    await open();

    expect(screen.getByText(/Введите код из приложения/)).toBeTruthy();
    expect(getAdminOverview).not.toHaveBeenCalled();
  });

  it("opens the panel once the server confirms access and the code", async () => {
    sessionMock.mockResolvedValue({ isAdmin: true, mfaEnabled: true, mfaVerified: true, mfaRecent: true });

    await open();

    expect(screen.getByRole("navigation", { name: "Разделы администрирования" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /На сайт/ }).getAttribute("href")).toBe("/");
    expect(screen.getByText("boss@example.com")).toBeTruthy();
    expect(getAdminOverview).toHaveBeenCalled();
  });

  it("shows a refusal - and no data - when the server says the access is gone", async () => {
    sessionMock.mockRejectedValue(new ApiError(403, "forbidden", "administrator access required"));

    await open();

    expect(screen.getByText("Доступ закрыт")).toBeTruthy();
    expect(getAdminOverview).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("does not open the panel when the check itself fails", async () => {
    sessionMock.mockRejectedValue(new ApiError(0, "network_error", "Не удалось связаться с сервером"));

    await open();

    expect(screen.getByText("Не удалось проверить доступ")).toBeTruthy();
    expect(getAdminOverview).not.toHaveBeenCalled();
  });

  it("sends the administrator back to the gate when a later request is refused", async () => {
    sessionMock.mockResolvedValueOnce({ isAdmin: true, mfaEnabled: true, mfaVerified: true, mfaRecent: true });
    vi.mocked(getAdminOverview).mockRejectedValue(new ApiError(403, "mfa_required", "confirm your two-factor code to continue"));
    sessionMock.mockResolvedValueOnce({ isAdmin: true, mfaEnabled: true, mfaVerified: false, mfaRecent: false });

    await open();
    await act(async () => {});

    expect(screen.getByText(/Введите код из приложения/)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Разделы администрирования" })).toBeNull();
  });
});
