import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";

afterEach(cleanup);

describe("the finance button in the top bar", () => {
  it("is not shown unless the screen offers it (the balance is switched off, or the person is not a trainer)", () => {
    render(<TopBar kicker="Аккаунт" title="Профиль" onOpenNotifications={() => {}} />);

    expect(screen.queryByRole("button", { name: /Финансы/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Уведомления" })).toBeTruthy();
  });

  it("sits next to the bell and opens the finance screen", () => {
    const open = vi.fn();
    render(<TopBar kicker="Аккаунт" title="Профиль" onOpenNotifications={() => {}} onOpenFinance={open} unreadNotifications={2} />);

    const buttons = screen.getAllByRole("button");
    const names = buttons.map((b) => b.textContent ?? "");
    expect(names.findIndex((n) => n.includes("Финансы"))).toBeLessThan(names.findIndex((n) => n.includes("2")));
    fireEvent.click(screen.getByRole("button", { name: /Финансы/ }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
