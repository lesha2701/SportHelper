import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { banAdminUser, getAdminUser, listAdminUsers, unbanAdminUser, type AdminUserCard, type AdminUserRow } from "../../api/admin";
import { ApiError } from "../../api/client";
import { UsersPage } from "./UsersPage";

vi.mock("../../api/admin", () => ({ listAdminUsers: vi.fn(), getAdminUser: vi.fn(), banAdminUser: vi.fn(), unbanAdminUser: vi.fn() }));

const listMock = vi.mocked(listAdminUsers);
const cardMock = vi.mocked(getAdminUser);
const banMock = vi.mocked(banAdminUser);
const unbanMock = vi.mocked(unbanAdminUser);

function row(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: "u1", email: "alice@example.com", emailVerified: true, firstName: "Алиса", lastName: "Иванова", isPlayer: true, isCoach: false,
    isAdmin: false, status: "active", deletionRequested: false, bannedUntil: null, createdAt: "2026-10-01T10:00:00Z",
    lastActiveAt: "2026-10-14T10:00:00Z", lastLoginAt: null, ...overrides,
  };
}

function card(overrides: Partial<AdminUserCard> = {}): AdminUserCard {
  return {
    ...row(), banReason: null, bannedAt: null, telegramLinked: false, trainingsCreated: 4, teamsCount: 1, listingsCount: 0, filesCount: 2,
    bans: [], history: [], ...overrides,
  };
}

const page = (items: AdminUserRow[], total = items.length) => ({ total, limit: 25, offset: 0, items });
const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  [listMock, cardMock, banMock, unbanMock].forEach((m) => m.mockReset());
  listMock.mockResolvedValue(page([row()]));
  cardMock.mockResolvedValue(card());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = async () => {
  render(<UsersPage />);
  await flush();
};
const lastQuery = () => listMock.mock.calls[listMock.mock.calls.length - 1]![0];

describe("the users list", () => {
  it("shows people with role and status, and asks the server for a page", async () => {
    await open();

    expect(screen.getByText("Алиса Иванова")).toBeTruthy();
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Игрок")).toBeTruthy();
    expect(within(table).getByText("Активен")).toBeTruthy();
    expect(lastQuery()).toMatchObject({ q: "", role: "", status: "", sort: "created_desc", limit: 25, offset: 0 });
  });

  it("waits for a pause in typing before searching, and starts from the first page", async () => {
    await open();
    listMock.mockClear();

    fireEvent.change(screen.getByLabelText("Поиск пользователей"), { target: { value: "ali" } });
    fireEvent.change(screen.getByLabelText("Поиск пользователей"), { target: { value: "alice" } });
    expect(listMock).not.toHaveBeenCalled();

    await act(async () => void vi.advanceTimersByTime(350));
    await flush();

    expect(listMock).toHaveBeenCalled();
    expect(lastQuery().q).toBe("alice");
    expect(lastQuery().offset).toBe(0);
  });

  it("sends the chosen filters and sorting to the server", async () => {
    await open();

    fireEvent.change(screen.getByLabelText("Роль"), { target: { value: "coach" } });
    await flush();
    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "banned" } });
    await flush();
    fireEvent.change(screen.getByLabelText("Сортировка"), { target: { value: "active_desc" } });
    await flush();

    expect(lastQuery()).toMatchObject({ role: "coach", status: "banned", sort: "active_desc" });
  });

  it("pages through results on the server", async () => {
    listMock.mockResolvedValue(page([row()], 60));
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await flush();

    expect(lastQuery().offset).toBe(25);
    expect(screen.getByText(/из 60/)).toBeTruthy();
  });

  it("explains an empty result instead of showing a blank table", async () => {
    listMock.mockResolvedValue(page([]));

    await open();

    expect(screen.getByText(/Никого не найдено/)).toBeTruthy();
  });

  it("shows the server's error with a retry", async () => {
    listMock.mockRejectedValueOnce(new ApiError(500, "internal", "Внутренняя ошибка"));
    await open();
    expect(screen.getByRole("alert").textContent).toContain("Внутренняя ошибка");

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await flush();

    expect(screen.getByText("Алиса Иванова")).toBeTruthy();
  });
});

describe("a user's card and blocking", () => {
  const openCard = async () => {
    await open();
    fireEvent.click(screen.getByText("Алиса Иванова"));
    await flush();
  };

  it("opens the card with the figures an administrator needs", async () => {
    await openCard();

    const drawer = screen.getByRole("complementary", { name: "Карточка пользователя" });
    expect(within(drawer).getByText("u1")).toBeTruthy();
    expect(within(drawer).getByText("Создано тренировок").nextSibling?.textContent).toBe("4");
    expect(within(drawer).getByText("Блокировок не было.")).toBeTruthy();
    expect(cardMock).toHaveBeenCalledWith("u1");
  });

  it("needs a written reason before it will block, and sends reason and term", async () => {
    banMock.mockResolvedValue(card({ status: "banned" }));
    await openCard();

    fireEvent.click(screen.getByRole("button", { name: "Заблокировать" }));
    const dialog = screen.getByRole("dialog", { name: "Заблокировать пользователя" });
    const submit = within(dialog).getByRole("button", { name: "Заблокировать" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "ab" } });
    expect(submit.disabled).toBe(true); // too short
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  Спам   в объявлениях " } });
    expect(submit.disabled).toBe(false);
    fireEvent.change(within(dialog).getByLabelText("Срок"), { target: { value: "30" } });
    fireEvent.click(submit);
    await flush();

    expect(banMock).toHaveBeenCalledWith("u1", "Спам в объявлениях", 30);
    expect(screen.queryByRole("dialog", { name: "Заблокировать пользователя" })).toBeNull();
  });

  it("offers a permanent block", async () => {
    banMock.mockResolvedValue(card({ status: "banned" }));
    await openCard();
    fireEvent.click(screen.getByRole("button", { name: "Заблокировать" }));
    const dialog = screen.getByRole("dialog", { name: "Заблокировать пользователя" });

    fireEvent.change(within(dialog).getByLabelText("Срок"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Мошенничество" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Заблокировать" }));
    await flush();

    expect(banMock).toHaveBeenCalledWith("u1", "Мошенничество", null);
  });

  it("keeps the dialog open and shows the server's refusal", async () => {
    banMock.mockRejectedValue(new ApiError(409, "already_banned", "Пользователь уже заблокирован."));
    await openCard();
    fireEvent.click(screen.getByRole("button", { name: "Заблокировать" }));
    const dialog = screen.getByRole("dialog", { name: "Заблокировать пользователя" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Спам" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Заблокировать" }));
    await flush();

    expect(within(screen.getByRole("dialog", { name: "Заблокировать пользователя" })).getByText("Пользователь уже заблокирован.")).toBeTruthy();
  });

  it("an administrator has no block button, only the explanation", async () => {
    cardMock.mockResolvedValue(card({ isAdmin: true }));
    await openCard();

    expect(screen.queryByRole("button", { name: "Заблокировать" })).toBeNull();
    expect(screen.getByText(/ADMIN_EMAILS/)).toBeTruthy();
  });

  it("a blocked person can be unblocked, with a reason, and the history is shown", async () => {
    cardMock.mockResolvedValue(
      card({
        status: "banned", banReason: "Спам", bannedUntil: null,
        bans: [{ id: "b1", reason: "Спам", bannedAt: "2026-10-10T10:00:00Z", expiresAt: null, liftedAt: null, liftKind: null, liftReason: null, admin: "boss@example.com", liftedBy: null }],
        history: [{ id: "h1", action: "ban", reason: "Спам", result: "success", createdAt: "2026-10-10T10:00:00Z", admin: "boss@example.com" }],
      }),
    );
    unbanMock.mockResolvedValue(card());
    await openCard();
    const drawer = screen.getByRole("complementary", { name: "Карточка пользователя" });
    expect(within(drawer).getByText(/Заблокирован бессрочно/)).toBeTruthy();
    expect(within(drawer).getAllByText("Блокировка").length).toBe(1);

    fireEvent.click(within(drawer).getByRole("button", { name: "Снять блокировку" }));
    const dialog = screen.getByRole("dialog", { name: "Снять блокировку" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Ошибка модератора" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Снять блокировку" }));
    await flush();

    expect(unbanMock).toHaveBeenCalledWith("u1", "Ошибка модератора");
  });
});
