import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMatch } from "../../api/matches";
import { getTeam } from "../../api/teams";
import type { Match } from "../../types/match";
import type { Team } from "../../types/team";
import { MatchForm } from "./MatchForm";

vi.mock("../../api/matches", () => ({ createMatch: vi.fn(), updateMatch: vi.fn() }));
vi.mock("../../api/teams", () => ({ getTeam: vi.fn() }));
vi.mock("../../toast", () => ({ toast: { success: vi.fn() } }));
vi.mock("../../appNav", () => ({ navigateApp: vi.fn() }));

const team = { id: "t1", tournaments: ["Кубок города", "Лига"], homeVenue: "Стадион «Динамо»" } as Team;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTeam).mockResolvedValue(team);
  vi.mocked(createMatch).mockResolvedValue({ id: "m1" } as Match);
});
afterEach(cleanup);

const place = () => screen.getByLabelText(/Место/) as HTMLInputElement;

describe("a new match of a team with settings", () => {
  it("takes the home venue for a home match, empties it for an away one, and keeps what the coach typed", async () => {
    render(<MatchForm token="t" teamId="t1" onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(place().value).toBe("Стадион «Динамо»"));
    fireEvent.click(screen.getByLabelText(/Домашний матч/));
    expect(place().value).toBe("");
    fireEvent.click(screen.getByLabelText(/Домашний матч/));
    expect(place().value).toBe("Стадион «Динамо»");

    fireEvent.change(place(), { target: { value: "Другое поле" } });
    fireEvent.click(screen.getByLabelText(/Домашний матч/));
    fireEvent.click(screen.getByLabelText(/Домашний матч/));
    expect(place().value).toBe("Другое поле");
  });

  it("offers the team's tournaments and saves the chosen one", async () => {
    const { container } = render(<MatchForm token="t" teamId="t1" onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll("#team-tournaments option")).toHaveLength(2));

    fireEvent.change(screen.getByLabelText(/Соперник/), { target: { value: "Орлы" } });
    fireEvent.change(screen.getByLabelText(/Дата/), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/Время/), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText(/Турнир/), { target: { value: "Лига" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать матч" }));

    await waitFor(() => expect(createMatch).toHaveBeenCalled());
    expect(createMatch).toHaveBeenCalledWith("t", "t1", expect.objectContaining({ tournament: "Лига", location: "Стадион «Динамо»", is_home: true }));
  });
});
