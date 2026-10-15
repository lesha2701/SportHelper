import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../../api/auth";
import { ApiError } from "../../api/client";
import type { User } from "../../types/user";
import { AccountSecurity, MfaSection } from "./AccountSecurity";

const flags = vi.hoisted(() => ({ telegram: true }));
vi.mock("../../features", () => ({ useTelegramEnabled: () => flags.telegram }));
vi.mock("../../api/auth");
const api = vi.mocked(authApi);

const logout = vi.fn();
const refreshUser = vi.fn();
let user: Partial<User>;
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ state: { status: "ready", token: "csrf", user }, logout, refreshUser }),
}));

const NOW = "2026-10-14T10:00:00Z";
const sessions: authApi.Session[] = [
  { id: "s-here", device: "Chrome · macOS", ipAddress: "10.0.0.1", createdAt: NOW, lastSeenAt: NOW, current: true },
  { id: "s-phone", device: "Safari · iPhone", ipAddress: "10.0.0.2", createdAt: NOW, lastSeenAt: NOW, current: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  flags.telegram = true;
  user = { email: "alice@example.com", emailVerified: true, telegramLinked: false, deletionRequestedAt: null, isAdmin: false };
  api.listSessions.mockResolvedValue(sessions);
  api.getMfaStatus.mockResolvedValue({ isAdmin: false, enabled: false, sessionVerified: false });
});
afterEach(cleanup);

const typeInto = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const apiError = (status: number, code: string, message: string, field: string | null = null) => new ApiError(status, code, message, field);

describe("email", () => {
  it("shows the address with its confirmation status", () => {
    render(<AccountSecurity />);

    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(screen.getByText("подтверждён")).toBeTruthy();
  });

  it("asks for the password and says a confirmation was sent to the NEW address", async () => {
    api.changeEmail.mockResolvedValue("sent");
    render(<AccountSecurity />);
    press("Изменить email");

    typeInto("Новый email", "new@example.com");
    typeInto("Текущий пароль", "my current password");
    press("Отправить подтверждение");

    await screen.findByText("new@example.com");
    expect(api.changeEmail).toHaveBeenCalledWith("new@example.com", "my current password");
    expect(screen.getByText(/Email изменится после подтверждения/)).toBeTruthy();
  });

  it("shows a wrong password next to the password field", async () => {
    api.changeEmail.mockRejectedValue(apiError(403, "invalid_password", "Неверный текущий пароль.", "password"));
    render(<AccountSecurity />);
    press("Изменить email");
    typeInto("Новый email", "new@example.com");
    typeInto("Текущий пароль", "wrong");

    press("Отправить подтверждение");

    await screen.findByText("Неверный текущий пароль.");
  });
});

describe("password", () => {
  it("changes it after checking the new one locally", async () => {
    api.changePassword.mockResolvedValue("Пароль изменён. На других устройствах вы вышли из аккаунта.");
    render(<AccountSecurity />);
    press("Сменить пароль");
    typeInto("Текущий пароль", "old password here");
    typeInto("Новый пароль", "short");
    press("Сменить пароль");
    expect(screen.getByText(/слишком короткий/)).toBeTruthy();
    expect(api.changePassword).not.toHaveBeenCalled();

    typeInto("Новый пароль", "a brand new passphrase");
    typeInto("Повторите новый пароль", "a brand new passphrase");
    press("Сменить пароль");

    await screen.findByText(/На других устройствах вы вышли из аккаунта/);
    expect(api.changePassword).toHaveBeenCalledWith("old password here", "a brand new passphrase", "a brand new passphrase");
  });
});

describe("sessions", () => {
  it("lists devices, marks this one, and can end another", async () => {
    api.revokeSession.mockResolvedValue(undefined);
    render(<AccountSecurity />);

    await screen.findByText("Safari · iPhone");
    expect(screen.getByText("это устройство")).toBeTruthy();
    const phone = screen.getByText("Safari · iPhone").closest("li")!;
    fireEvent.click(within(phone).getByRole("button", { name: "Завершить" }));

    await waitFor(() => expect(api.revokeSession).toHaveBeenCalledWith("s-phone"));
    expect(logout).not.toHaveBeenCalled(); // ending ANOTHER device keeps this one signed in
    expect(api.listSessions).toHaveBeenCalledTimes(2); // and the list refreshes
  });

  it("this device has no 'end' button (use sign out), so you can't lock yourself out by accident", async () => {
    render(<AccountSecurity />);

    const here = (await screen.findByText("Chrome · macOS")).closest("li")!;

    expect(within(here).queryByRole("button")).toBeNull();
  });

  it("asks before signing out everywhere, then leaves for the public site", async () => {
    api.logoutAll.mockResolvedValue(undefined);
    render(<AccountSecurity />);
    await screen.findByText("Safari · iPhone");

    press("Выйти на всех устройствах");
    expect(api.logoutAll).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Выйти везде" }));

    await waitFor(() => expect(api.logoutAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it("plain sign-out is one click", () => {
    render(<AccountSecurity />);

    press("Выйти из аккаунта");

    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe("deleting the account", () => {
  it("needs the password and says what will and will not be deleted", async () => {
    api.requestAccountDeletion.mockResolvedValue("Запрос принят.");
    render(<AccountSecurity />);
    expect(screen.getByText(/не удаляются каскадом/)).toBeTruthy();

    press("Запросить удаление");
    typeInto("Пароль для подтверждения", "my current password");
    press("Удалить аккаунт через 14 дней");

    await waitFor(() => expect(api.requestAccountDeletion).toHaveBeenCalledWith("my current password"));
    expect(refreshUser).toHaveBeenCalled();
  });

  it("while a deletion is pending it can be cancelled", async () => {
    user = { ...user, deletionRequestedAt: NOW };
    api.cancelAccountDeletion.mockResolvedValue(undefined);
    render(<AccountSecurity />);

    expect(screen.getByText(/Удаление запрошено/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Запросить удаление" })).toBeNull();
    press("Отменить удаление");

    await waitFor(() => expect(api.cancelAccountDeletion).toHaveBeenCalled());
  });
});

describe("telegram (optional)", () => {
  it("is not offered at all while the integration is switched off", () => {
    flags.telegram = false;
    render(<AccountSecurity />);

    expect(screen.queryByText("Уведомления в Telegram")).toBeNull();
    expect(screen.queryByRole("button", { name: "Подключить Telegram" })).toBeNull();
  });

  it("is described as optional and can be linked through the bot", async () => {
    api.startTelegramLink.mockResolvedValue({ botUrl: "https://t.me/SportBot?start=link_x", expiresIn: 1800 });
    render(<AccountSecurity />);
    expect(screen.getByText(/Сайт работает без Telegram/)).toBeTruthy();

    press("Подключить Telegram");

    const link = await screen.findByRole("link", { name: /Открыть бота/ });
    expect(link.getAttribute("href")).toBe("https://t.me/SportBot?start=link_x");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("can be unlinked once connected", async () => {
    user = { ...user, telegramLinked: true };
    api.unlinkTelegram.mockResolvedValue(undefined);
    render(<AccountSecurity />);

    press("Отвязать Telegram");

    await waitFor(() => expect(api.unlinkTelegram).toHaveBeenCalled());
  });
});

describe("two-factor", () => {
  it("is only shown to administrators", async () => {
    render(<AccountSecurity />);
    await screen.findByText("Safari · iPhone");

    expect(screen.queryByText("Двухфакторная защита")).toBeNull();
  });

  it("walks an administrator through setup and shows the recovery codes once", async () => {
    api.getMfaStatus.mockResolvedValue({ isAdmin: true, enabled: false, sessionVerified: false });
    api.setupMfa.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/x" });
    api.enableMfa.mockResolvedValue(["aaaaaaaaaa", "bbbbbbbbbb"]);
    render(<AccountSecurity />);

    await screen.findByText("Двухфакторная защита");
    typeInto("Пароль (для подтверждения)", "correct horse battery");
    press("Настроить");
    await screen.findByText("JBSWY3DPEHPK3PXP");
    expect(api.setupMfa).toHaveBeenCalledWith("correct horse battery");
    typeInto("Код из приложения", "123456");
    press("Включить защиту");

    await screen.findByText(/Сохраните резервные коды/);
    expect(api.enableMfa).toHaveBeenCalledWith("123456");
    expect(screen.getByText(/aaaaaaaaaa/)).toBeTruthy();
  });

  it("tells a waiting screen about it only AFTER the recovery codes were saved - they are shown just once", async () => {
    api.getMfaStatus.mockResolvedValue({ isAdmin: true, enabled: false, sessionVerified: false });
    api.setupMfa.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/x" });
    api.enableMfa.mockResolvedValue(["aaaaaaaaaa", "bbbbbbbbbb"]);
    const changed = vi.fn();
    render(<MfaSection onChanged={changed} />);

    await screen.findByText("Двухфакторная защита");
    typeInto("Пароль (для подтверждения)", "correct horse battery");
    press("Настроить");
    await screen.findByText("JBSWY3DPEHPK3PXP");
    expect(changed).toHaveBeenCalledTimes(1); // enrolment started
    typeInto("Код из приложения", "123456");
    press("Включить защиту");
    await screen.findByText(/Сохраните резервные коды/);

    expect(changed).toHaveBeenCalledTimes(1); // the codes are still on screen: do not move on yet
    press("Я сохранил коды");
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
