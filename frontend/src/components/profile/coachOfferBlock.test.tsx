import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileMe } from "../../types/profile";
import { ProfileSummary } from "./ProfileSummary";

vi.mock("../../api/bookings", () => ({ listCoachPendingBookings: vi.fn(async () => []) }));
vi.mock("../../api/stats", () => ({ getPlayerStats: vi.fn(async () => ({ attendanceRate: null })) }));
vi.mock("../../api/users", () => ({ uploadUserAvatar: vi.fn(), removeUserAvatar: vi.fn() }));
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => null }));
vi.mock("./AchievementsGallery", () => ({ AchievementsGallery: () => null }));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ state: { status: "ready", token: "t", user: { id: "u1", photoUrl: null, avatarFileId: null, isAdmin: false } }, updateUser: vi.fn(), logout: vi.fn() }),
}));

afterEach(cleanup);

const player = { userId: "u1", fullName: "Игорь", age: 20, heightCm: null, weightKg: null, sport: "Теннис", position: null, level: null, goals: null, loadRestrictions: null };
const coach = { userId: "u1", fullName: "Анна", sport: "Теннис", experienceYears: 3, specialization: null, description: null };

function summary(profile: ProfileMe) {
  const noop = vi.fn();
  render(
    <ProfileSummary token="t" profile={profile} canSwitchRole={false} onEdit={noop} onSwitchMode={noop} onCreateOther={noop} onOpenMyStats={noop}
      onOpenHelp={noop} onOpenSupport={noop} onOpenSettings={noop} onOpenMarketplaceSettings={noop} onOpenMyBookings={noop} onOpenCoachBookings={noop}
      onOpenIncomingBookings={noop} onOpenNotifications={noop} />,
  );
}

/** The buttons in the card whose title is `title` (the title sits in the card's head, the rows in the card's body). */
function rowsUnder(title: string): string[] {
  const heading = screen.getByRole("heading", { name: title });
  const card = heading.parentElement!.parentElement as HTMLElement;
  return within(card).getAllByRole("button").map((b) => b.textContent ?? "");
}

describe("profile actions are grouped by purpose", () => {
  it("keeps coach requests in «Объявления» and separates progress, account, and help", () => {
    summary({ activeMode: "coach", player: null, coach });
    const offers = rowsUnder("Объявления").join("|");
    expect(offers).toContain("Мои объявления");
    expect(offers).toContain("Входящие заявки");
    expect(offers).toContain("Записи");
    expect(offers).toContain("Найти зал");
    expect(rowsUnder("Занятия и прогресс").join("|")).toContain("Моя статистика");
    expect(rowsUnder("Аккаунт").join("|")).toContain("Настройки");
    expect(rowsUnder("Аккаунт").join("|")).toContain("Уведомления");
    expect(rowsUnder("Аккаунт").join("|")).toContain("Выйти из аккаунта");
    expect(rowsUnder("Помощь и связь").join("|")).toContain("Помощь");
    expect(rowsUnder("Помощь и связь").join("|")).toContain("Поддержка");
    expect(screen.queryByRole("heading", { name: "Тренировки" })).toBeNull();
  });

  it("keeps «Мои брони» with the player's progress", () => {
    summary({ activeMode: "player", player, coach: null });
    expect(rowsUnder("Занятия и прогресс").join("|")).toContain("Мои брони");
    expect(screen.queryByRole("heading", { name: "Объявления" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Найти зал" })).toBeNull();
  });
});
