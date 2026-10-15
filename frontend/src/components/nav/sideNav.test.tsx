import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideNav } from "./SideNav";

vi.mock("../shared/AuthenticatedImage", () => ({
  AuthenticatedImage: ({ fileId }: { fileId: string }) => <img data-testid="team-logo" data-file={fileId} alt="" />,
}));

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

describe("the team card in the side navigation", () => {
  const team = { name: "Тест", roleLabel: "Основной тренер", initial: "Т" };

  it("shows the uploaded team logo over the initial", () => {
    render(<SideNav {...props} team={{ ...team, logo: { token: "t", fileId: "f1" } }} />);

    expect(screen.getByTestId("team-logo").getAttribute("data-file")).toBe("f1");
  });

  it("falls back to the initial when the team has no logo", () => {
    render(<SideNav {...props} team={team} />);

    expect(screen.queryByTestId("team-logo")).toBeNull();
    expect(screen.getByText("Т")).not.toBeNull();
  });
});
