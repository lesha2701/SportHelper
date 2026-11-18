import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TitleWithBack } from "./BackArrow";

afterEach(cleanup);

describe("the back arrow next to a page title", () => {
  it("is a button with no text, only an arrow, and goes back when pressed", () => {
    const onBack = vi.fn();
    render(
      <TitleWithBack onBack={onBack}>
        <h1>Новая команда</h1>
      </TitleWithBack>,
    );

    const arrow = screen.getByRole("button", { name: "Назад" });
    expect(arrow.textContent).toBe("");
    fireEvent.click(arrow);

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Новая команда" })).toBeTruthy();
  });

  it("is not drawn when there is nowhere to go back (the title stays)", () => {
    render(
      <TitleWithBack>
        <h1>Профиль тренера</h1>
      </TitleWithBack>,
    );

    expect(screen.queryByRole("button", { name: "Назад" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Профиль тренера" })).toBeTruthy();
  });

  it("cannot be pressed while the screen is busy (disabled)", () => {
    const onBack = vi.fn();
    render(
      <TitleWithBack onBack={onBack} disabled>
        <h1>Редактирование объявления</h1>
      </TitleWithBack>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));

    expect(onBack).not.toHaveBeenCalled();
  });
});
