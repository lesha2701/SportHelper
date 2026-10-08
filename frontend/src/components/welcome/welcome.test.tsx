import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeOnboarding } from "../../api/users";
import { ThemeProvider } from "../../context/ThemeContext";
import { toast } from "../../toast";
import type { User } from "../../types/user";
import { HelpScreen } from "../profile/HelpScreen";
import { SettingsScreen } from "../profile/SettingsScreen";
import { OnboardingGate } from "./OnboardingGate";
import { WELCOME_STEP_COUNT } from "./WelcomeGuide";

vi.mock("../../api/users", () => ({ completeOnboarding: vi.fn() }));
// Settings also renders the notification/privacy cards; their data is irrelevant here.
vi.mock("../../api/notifications", () => ({ getNotificationPreferences: vi.fn(() => new Promise(() => {})) }));
vi.mock("../../api/privacy", () => ({ getPrivacySettings: vi.fn(() => new Promise(() => {})) }));

const completeMock = vi.mocked(completeOnboarding);

function makeUser(completedOnboardingVersion: number): User {
  return {
    id: "u1",
    telegramId: 1,
    username: null,
    firstName: "Test",
    lastName: null,
    photoUrl: null,
    avatarFileId: null,
    languageCode: "ru",
    createdAt: "2026-01-01T00:00:00Z",
    lastLoginAt: null,
    completedOnboardingVersion,
    currentOnboardingVersion: 1,
  };
}

function renderGate(version: number, onUserUpdated = vi.fn()) {
  render(
    <OnboardingGate token="t" user={makeUser(version)} onUserUpdated={onUserUpdated}>
      <div>MAIN APP</div>
    </OnboardingGate>,
  );
  return onUserUpdated;
}

const dialog = () => screen.queryByRole("dialog");
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  completeMock.mockReset();
  completeMock.mockResolvedValue(makeUser(1));
});

afterEach(cleanup);

describe("automatic onboarding", () => {
  it("opens for a user who has not completed it (version 0), instead of the app", () => {
    renderGate(0);

    expect(dialog()).not.toBeNull();
    expect(screen.getByText("Добро пожаловать в SportArena")).not.toBeNull();
    expect(screen.queryByText("MAIN APP")).toBeNull();
  });

  it("does not open for a user who completed the current version", () => {
    renderGate(1);

    expect(dialog()).toBeNull();
    expect(screen.getByText("MAIN APP")).not.toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("'Далее' moves forward and 'Назад' moves back", () => {
    renderGate(0);

    expect(screen.queryByRole("button", { name: "Назад" })).toBeNull(); // not on the first screen
    click("Начать знакомство");
    expect(screen.getByText("Всё важное — в одном месте")).not.toBeNull();

    click("Далее");
    expect(screen.getByText("Ваша команда и ваш прогресс")).not.toBeNull();

    click("Назад");
    expect(screen.getByText("Всё важное — в одном месте")).not.toBeNull();
  });

  it("explains the main things in some detail: solo trainings, team management, the library, tasks, personal coaches", () => {
    renderGate(0);
    const seen: string[] = [];
    click("Начать знакомство");
    for (let i = 1; i < WELCOME_STEP_COUNT; i++) {
      seen.push(document.querySelector("[role=dialog]")?.textContent ?? "");
      if (i < WELCOME_STEP_COUNT - 1) click("Далее");
    }
    const all = seen.join(" ");

    expect(all).toContain("Личные тренировки — для себя");
    expect(all).toContain("круговую тренировку"); // the circuit style
    expect(all).toContain("Гибкое управление командой");
    expect(all).toContain("Библиотека упражнений");
    expect(all).toContain("Задания и отчёты");
    expect(all).toContain("Личный тренер"); // a player books a coach
    expect(all).toContain("Свои занятия с игроками"); // a coach runs personal sessions
    expect(all).toContain("ИИ и уведомления");
  });

  it("can be skipped from the first screen: closes at once and saves the version", async () => {
    const onUserUpdated = renderGate(0);

    click("Пропустить");

    expect(dialog()).toBeNull();
    expect(screen.getByText("MAIN APP")).not.toBeNull();
    expect(completeMock).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(onUserUpdated).toHaveBeenCalledWith(makeUser(1));
  });

  it("'Перейти в SportArena' on the last screen completes it", async () => {
    renderGate(0);

    click("Начать знакомство");
    for (let i = 1; i < WELCOME_STEP_COUNT - 1; i++) click("Далее");
    expect(screen.getByText("Используйте SportArena так, как удобно вам")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Далее" })).toBeNull();
    click("Перейти в SportArena");

    expect(dialog()).toBeNull();
    expect(screen.getByText("MAIN APP")).not.toBeNull();
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("a failed save does not block the app and shows a soft message", async () => {
    completeMock.mockRejectedValue(new Error("network"));
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => {});
    const onUserUpdated = renderGate(0);

    click("Пропустить");
    await act(async () => {});

    expect(screen.getByText("MAIN APP")).not.toBeNull();
    expect(errorToast).toHaveBeenCalledTimes(1);
    expect(onUserUpdated).not.toHaveBeenCalled();
    errorToast.mockRestore();
  });

  it("Escape does not close it", () => {
    renderGate(0);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(dialog()).not.toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });
});

describe("manual replay from Help", () => {
  const openFromHelp = () => {
    render(<HelpScreen onBack={() => {}} roles={{ player: true, coach: true }} />);
    click("Как работает SportArena");
  };

  it("opens the guide again from «Помощь» and never touches the saved state", () => {
    openFromHelp();

    expect(dialog()).not.toBeNull();
    expect(screen.getByText("Добро пожаловать в SportArena")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Пропустить" })).toBeNull();

    click("Начать знакомство");
    for (let i = 1; i < WELCOME_STEP_COUNT - 1; i++) click("Далее");
    expect(screen.getAllByText("Ваша роль")).toHaveLength(2); // both roles marked

    click("Готово");
    expect(dialog()).toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("works even after the user already completed onboarding, and can be closed with ✕", () => {
    // The completed state lives on the account; opening it by hand has no dependency on it.
    const { unmount } = render(
      <OnboardingGate token="t" user={makeUser(1)} onUserUpdated={vi.fn()}>
        <HelpScreen onBack={() => {}} />
      </OnboardingGate>,
    );
    expect(dialog()).toBeNull();

    click("Как работает SportArena");
    expect(dialog()).not.toBeNull();
    click("Закрыть");

    expect(dialog()).toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
    unmount();
  });

  it("is always available from Settings, and closing it leaves the saved state alone", () => {
    render(
      <ThemeProvider>
        <SettingsScreen token="t" onBack={() => {}} roles={{ player: true, coach: false }} />
      </ThemeProvider>,
    );

    click("Как работает SportArena");
    expect(dialog()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Пропустить" })).toBeNull();

    click("Закрыть");
    expect(dialog()).toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });
});
