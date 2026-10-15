import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideNav } from "./SideNav";

afterEach(cleanup);

const props = {
  items: [{ key: "dashboard" as const, label: "Главная", icon: "home" as const }],
  active: "dashboard" as const,
  onChange: () => {},
  user: { name: "Алиса", sub: "Игрок", photoUrl: null, initial: "А" },
  onOpenProfile: () => {},
};

describe("the admin button in the side navigation", () => {
  it("is absent for everyone the server has not marked as an administrator", () => {
    render(<SideNav {...props} />);

    expect(screen.queryByRole("button", { name: "Админ-панель" })).toBeNull();
  });

  it("opens the panel for an administrator", () => {
    const open = vi.fn();
    render(<SideNav {...props} onOpenAdmin={open} />);

    fireEvent.click(screen.getByRole("button", { name: "Админ-панель" }));

    expect(open).toHaveBeenCalledTimes(1);
  });
});
