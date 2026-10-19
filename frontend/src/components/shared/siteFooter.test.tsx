import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../nav/AppShell";
import { AuthLayout } from "../auth/AuthLayout";
import { SiteFooter } from "./SiteFooter";

vi.mock("../../hooks/useIsDesktop", () => ({ useIsDesktop: () => desktop }));
let desktop = true;

afterEach(cleanup);

const REQUISITES = ["ИП Перекрестов Вячеслав Дмитриевич", "ИНН: 770373336381", "ОГРН: 326774600747726", "Для связи по вопросам рекламы:"];

function expectFullFooter() {
  const footer = screen.getByRole("contentinfo");
  expect(footer.textContent).toContain(`© ${new Date().getFullYear()} SportArenaGlobal`);
  for (const line of REQUISITES) expect(footer.textContent).toContain(line);
  expect(screen.getByRole("link", { name: "Пользовательское соглашение" }).getAttribute("href")).toBe("/terms");
  expect(screen.getByRole("link", { name: "Политика обработки персональных данных" }).getAttribute("href")).toBe("/privacy");
  expect(screen.getByRole("link", { name: "perekrestov_bus@mail.ru" }).getAttribute("href")).toBe("mailto:perekrestov_bus@mail.ru");
}

describe("the site footer", () => {
  it("carries the operator's details, the two documents and the advertising contact", () => {
    render(<SiteFooter />);
    expectFullFooter();
  });

  it("is on the sign-in and sign-up screens", () => {
    render(<AuthLayout title="Вход">форма</AuthLayout>);
    expectFullFooter();
  });

  it("is inside the signed-in app, on desktop and on a phone", () => {
    const shell = (
      <AppShell
        navItems={[{ key: "home", label: "Главная", icon: "home" }]}
        activeTab="home"
        onChangeTab={() => {}}
        hasOverlay={false}
        sideUser={{ name: "Алиса", sub: "Игрок", photoUrl: null, initial: "А" }}
        onOpenProfile={() => {}}
      >
        содержимое
      </AppShell>
    );

    desktop = true;
    render(shell);
    expectFullFooter();
    cleanup();

    desktop = false;
    render(shell);
    expectFullFooter();
  });
});
