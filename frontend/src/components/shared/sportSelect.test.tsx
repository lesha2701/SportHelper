import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEAM_ROLE_LABELS } from "../../types/team";
import { COMMON_SPORTS } from "../../types/profile";
import { CoachProfileForm } from "../profile/CoachProfileForm";
import { PlayerProfileForm } from "../profile/PlayerProfileForm";
import { SportSelect } from "./SportSelect";

afterEach(cleanup);

describe("the sport picker", () => {
  it("offers the sports from the list, starting with a prompt", () => {
    render(<SportSelect value="" onChange={() => {}} />);

    const options = Array.from((screen.getByRole("combobox") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["Выберите вид спорта", ...COMMON_SPORTS]);
    for (const sport of ["Футбол", "Баскетбол", "Хоккей", "Плавание", "Боевые искусства", "Большой теннис", "Киберспорт"]) {
      expect(options).toContain(sport);
    }
  });

  it("is required and reports the choice", () => {
    const onChange = vi.fn();
    render(<SportSelect value="" onChange={onChange} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.required).toBe(true);
    fireEvent.change(select, { target: { value: "Хоккей" } });
    expect(onChange).toHaveBeenCalledWith("Хоккей");
  });

  it("keeps an older free-text value selectable instead of dropping it", () => {
    render(<SportSelect value="керлинг" onChange={() => {}} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("керлинг");
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("керлинг");
  });
});

describe("the profile forms ask for the sport", () => {
  it("player form", () => {
    render(<PlayerProfileForm initial={null} onSubmit={async () => {}} />);

    expect((screen.getByRole("combobox", { name: /Вид спорта/ }) as HTMLSelectElement).value).toBe("");
  });

  it("coach form sends the chosen sport", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<CoachProfileForm initial={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Имя/), { target: { value: "Анна" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Вид спорта/ }), { target: { value: "Плавание" } });
    fireEvent.submit(screen.getByRole("button", { name: /Сохранить/ }).closest("form") as HTMLFormElement);

    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ full_name: "Анна", sport: "Плавание" }));
  });
});

describe("wording", () => {
  it("calls the head of a team «Главный тренер»", () => {
    expect(TEAM_ROLE_LABELS.head_coach).toBe("Главный тренер");
  });
});
