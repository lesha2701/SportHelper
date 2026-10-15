import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import * as authApi from "./api/auth";
import type { User } from "./types/user";
import App from "./App";
import { ThemeProvider } from "./context/ThemeContext";

vi.mock("./api/auth");
vi.mock("./api/coachListings", () => ({ listListings: vi.fn(() => Promise.resolve([])) }));
// The signed-in app has its own tests; here only the routing decision matters.
vi.mock("./Workspace", () => ({
  Workspace: () => <div>SIGNED-IN APP {window.location.pathname + window.location.search}</div>,
}));
vi.mock("./components/welcome/OnboardingGate", () => ({ OnboardingGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./components/coaches/CoachMarketplaceScreen", () => ({
  CoachMarketplaceScreen: (props: { guest?: boolean; initialListingId?: string | null }) => (
    <div>CATALOGUE guest={String(props.guest)} listing={props.initialListingId ?? "-"}</div>
  ),
}));

const api = vi.mocked(authApi);
const alice = { id: "u1", firstName: "Алиса", email: "alice@example.com", telegramLinked: false } as User;

function open(path: string) {
  window.history.replaceState(null, "", path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}
const here = () => window.location.pathname + window.location.search;

function asGuest() {
  api.fetchMe.mockRejectedValue(new ApiError(401, "unauthorized", "authentication required"));
}
function asUser() {
  api.fetchMe.mockResolvedValue({ user: alice, csrfToken: "csrf" });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("a visitor without an account", () => {
  beforeEach(asGuest);

  it("sees a real home page, not a login wall", async () => {
    open("/");

    expect(await screen.findByRole("heading", { level: 1, name: /Тренируйся с планом/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Найти тренера" }).getAttribute("href")).toBe("/coaches");
    expect(screen.getAllByRole("link", { name: "Регистрация" }).length).toBeGreaterThan(0);
  });

  it("can open the coach catalogue", async () => {
    open("/coaches?listing=L7");

    expect(await screen.findByText("CATALOGUE guest=true listing=L7")).toBeTruthy();
  });

  it("can read the legal documents", async () => {
    open("/terms");
    expect(await screen.findByRole("heading", { name: "Пользовательское соглашение" })).toBeTruthy();

    cleanup();
    open("/privacy");
    expect(await screen.findByRole("heading", { name: "Политика конфиденциальности" })).toBeTruthy();
  });

  it("is sent to sign in — and brought back — when opening a link meant for the app", async () => {
    open("/?invite=abc");

    await waitFor(() => expect(here()).toBe("/login?next=%2F%3Finvite%3Dabc"));
    expect(await screen.findByRole("heading", { name: "Вход" })).toBeTruthy();
  });

  it("a notification deep link survives sign-in too", async () => {
    open("/?open=booking_requested&id=77");

    await waitFor(() => expect(here()).toContain("/login?next="));
    expect(decodeURIComponent(here())).toContain("/?open=booking_requested&id=77");
  });

  it("an unknown address gets a page with a way home, not a blank screen", async () => {
    open("/no-such-page");

    expect(await screen.findByText("Такой страницы нет")).toBeTruthy();
    expect(screen.getByRole("link", { name: "На главную" })).toBeTruthy();
  });

  it("serves the sign-up, sign-in and recovery pages", async () => {
    for (const [path, title] of [
      ["/login", "Вход"],
      ["/register", "Создать аккаунт"],
      ["/forgot-password", "Забыли пароль?"],
      ["/password-changed", "Пароль изменён"],
    ] as const) {
      open(path);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
      cleanup();
    }
  });
});

describe("a signed-in user", () => {
  beforeEach(asUser);

  it("lands in the app", async () => {
    open("/");

    expect(await screen.findByText(/SIGNED-IN APP/)).toBeTruthy();
  });

  it("is not shown the sign-in page again: they continue where they were headed", async () => {
    open("/login?next=%2F%3Fbook%3D42");

    await waitFor(() => expect(here()).toBe("/?book=42"));
    expect(await screen.findByText(/SIGNED-IN APP/)).toBeTruthy();
  });

  it("is not tricked into leaving the site by a crafted next=", async () => {
    open("/login?next=https%3A%2F%2Fevil.example");

    await waitFor(() => expect(here()).toBe("/"));
  });

  it("opens a shared catalogue link inside the app, so booking works", async () => {
    open("/coaches?listing=L9&junk=1");

    await waitFor(() => expect(here()).toBe("/?listing=L9"));
    expect(await screen.findByText(/SIGNED-IN APP/)).toBeTruthy();
  });

  it("email links work for them as well", async () => {
    api.inspectVerification.mockResolvedValue({ valid: true, email: "a***e@example.com", firstName: "Алиса" });
    open("/verify-email?token=t1");

    expect(await screen.findByText("Подтвердите email")).toBeTruthy();
  });
});

describe("when the server cannot be reached", () => {
  it("says so and offers to retry", async () => {
    api.fetchMe.mockRejectedValue(new ApiError(0, "network_error", "Не удалось связаться с сервером"));

    open("/");

    expect(await screen.findByText("Нет связи с сервером")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });
});

describe("the administration panel route", () => {
  beforeEach(() => {
    vi.doMock("./components/admin/AdminApp", () => ({ default: () => <div>ADMIN PANEL</div> }));
  });

  it("looks like a missing page to a visitor without an account", async () => {
    asGuest();
    open("/admin");

    expect(await screen.findByText("Такой страницы нет")).toBeTruthy();
    expect(screen.queryByText("ADMIN PANEL")).toBeNull();
  });

  it("looks like a missing page to an ordinary signed-in user, even deep inside /admin", async () => {
    asUser();
    open("/admin/users");

    expect(await screen.findByText("Такой страницы нет")).toBeTruthy();
    expect(screen.queryByText("ADMIN PANEL")).toBeNull();
    expect(screen.queryByText(/SIGNED-IN APP/)).toBeNull();
  });

  it("is not unlocked by anything in the URL", async () => {
    asUser();
    open("/admin?isAdmin=true&admin=1");

    expect(await screen.findByText("Такой страницы нет")).toBeTruthy();
  });

  it("opens for an account the server marks as an administrator", async () => {
    api.fetchMe.mockResolvedValue({ user: { ...alice, isAdmin: true }, csrfToken: "csrf" });
    open("/admin");

    expect(await screen.findByText("ADMIN PANEL")).toBeTruthy();
  });
});
