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
      onOpenHelp={noop} onOpenSettings={noop} onOpenMarketplaceSettings={noop} onOpenMyBookings={noop} onOpenCoachBookings={noop}
      onOpenIncomingBookings={noop} onOpenNotifications={noop} />,
  );
}

/** The buttons under a heading, up to the next one. */
function rowsUnder(title: string): string[] {
  const heading = screen.getByRole("heading", { name: title });
  const list = heading.nextElementSibling as HTMLElement;
  return within(list).getAllByRole("button").map((b) => b.textContent ?? "");
}

describe("the coach's requests and bookings sit in the «Объявления» block", () => {
  it("puts «Входящие заявки» and «Записи» under «Объявления», not under «Тренировки»", () => {
    summary({ activeMode: "coach", player: null, coach });
    const offers = rowsUnder("Объявления").join("|");
    expect(offers).toContain("Мои объявления");
    expect(offers).toContain("Входящие заявки");
    expect(offers).toContain("Записи");
    const trainings = rowsUnder("Тренировки").join("|");
    expect(trainings).not.toContain("Входящие заявки");
    expect(trainings).not.toContain("Записи");
    expect(trainings).toContain("Моя статистика");
  });

  it("keeps «Мои брони» in the player's own list", () => {
    summary({ activeMode: "player", player, coach: null });
    expect(screen.getByRole("button", { name: /Мои брони/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Объявления" })).toBeNull();
  });
});
