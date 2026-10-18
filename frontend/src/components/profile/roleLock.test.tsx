import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileMe } from "../../types/profile";
import { Onboarding } from "./Onboarding";
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

function summary(profile: ProfileMe, canSwitchRole: boolean) {
  const noop = vi.fn();
  render(
    <ProfileSummary
      token="t"
      profile={profile}
      canSwitchRole={canSwitchRole}
      onEdit={noop}
      onSwitchMode={noop}
      onCreateOther={noop}
      onOpenMyStats={noop}
      onOpenHelp={noop}
      onOpenSettings={noop}
      onOpenMarketplaceSettings={noop}
      onOpenMyBookings={noop}
      onOpenCoachBookings={noop}
      onOpenIncomingBookings={noop}
      onOpenNotifications={noop}
    />,
  );
}

describe("the role is fixed at registration", () => {
  it("offers an ordinary player no way to switch or to start a coach profile", () => {
    summary({ activeMode: "player", player, coach: null }, false);

    expect(screen.queryByRole("button", { name: /Завести профиль тренера/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Переключиться/ })).toBeNull();
  });

  it("offers an ordinary coach no way to start a player profile", () => {
    summary({ activeMode: "coach", player: null, coach }, false);

    expect(screen.queryByRole("button", { name: /Завести профиль игрока/ })).toBeNull();
  });

  it("hides the switch even for old accounts that still hold both profiles", () => {
    summary({ activeMode: "coach", player, coach }, false);

    expect(screen.queryByRole("button", { name: /Переключиться/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Я игрок" })).toBeNull();
  });

  it("lets an administrator switch and start the other profile", () => {
    summary({ activeMode: "player", player, coach: null }, true);
    expect(screen.getByRole("button", { name: /Завести профиль тренера/ })).toBeTruthy();
    cleanup();

    summary({ activeMode: "player", player, coach }, true);
    expect(screen.getByRole("button", { name: /Переключиться на тренера/ })).toBeTruthy();
  });

  it("onboarding offers a fixed role only its own profile", () => {
    const choosePlayer = vi.fn();
    const chooseCoach = vi.fn();
    render(<Onboarding onChoosePlayer={choosePlayer} onChooseCoach={chooseCoach} preferredRole="coach" />);

    expect(screen.queryByRole("button", { name: /игрока|Я игрок/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Создать профиль тренера" }));
    expect(chooseCoach).toHaveBeenCalled();
    expect(choosePlayer).not.toHaveBeenCalled();
  });

  it("onboarding still offers both to an administrator and to an account that has no role yet", () => {
    render(<Onboarding onChoosePlayer={vi.fn()} onChooseCoach={vi.fn()} preferredRole="player" canChooseBoth />);
    expect(screen.getByRole("button", { name: "Я игрок" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Я тренер" })).toBeTruthy();
    cleanup();

    render(<Onboarding onChoosePlayer={vi.fn()} onChooseCoach={vi.fn()} preferredRole={null} />);
    expect(screen.getByRole("button", { name: "Я игрок" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Я тренер" })).toBeTruthy();
  });
});
