import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyticsAllowed, readCookieChoice } from "../../legal/cookieConsent";
import { CookieBanner } from "./CookieBanner";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the cookie banner", () => {
  it("asks with the approved wording and links the policy", () => {
    render(<CookieBanner />);

    expect(
      screen.getByText(/Мы используем необходимые cookie для работы Сервиса и, с вашего согласия, аналитические cookie\./),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Политике обработки персональных данных" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("button", { name: "Принять все" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Только необходимые" })).toBeTruthy();
    expect(readCookieChoice()).toBeNull();
  });

  it("remembers 'accept all' and goes away", () => {
    render(<CookieBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Принять все" }));

    expect(screen.queryByRole("region", { name: "Файлы cookie" })).toBeNull();
    expect(readCookieChoice()).toBe("all");
    expect(analyticsAllowed()).toBe(true);
  });

  it("remembers 'only necessary' and keeps analytics off", () => {
    render(<CookieBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Только необходимые" }));

    expect(readCookieChoice()).toBe("necessary");
    expect(analyticsAllowed()).toBe(false);
  });

  it("does not ask again once a choice is stored", () => {
    window.localStorage.setItem("sag_cookie_choice", JSON.stringify({ choice: "necessary", at: "2026-10-20T00:00:00Z" }));

    render(<CookieBanner />);

    expect(screen.queryByRole("region", { name: "Файлы cookie" })).toBeNull();
  });

  it("treats a damaged stored value as no choice", () => {
    window.localStorage.setItem("sag_cookie_choice", "not json");

    render(<CookieBanner />);

    expect(screen.getByRole("region", { name: "Файлы cookie" })).toBeTruthy();
  });
});
