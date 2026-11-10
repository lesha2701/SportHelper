import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateTeam } from "../../api/teams";
import type { Team } from "../../types/team";
import { CreateTeamForm } from "./CreateTeamForm";

vi.mock("../../api/teams", () => ({ createTeam: vi.fn(), updateTeam: vi.fn() }));
vi.mock("../shared/SportSelect", () => ({ SportSelect: () => null }));

const team = {
  id: "t1", name: "Ястребы", description: null, sport: "Футбол", ageCategory: null, level: null,
  tournaments: ["Лига"], homeVenue: "Арена",
} as Team;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateTeam).mockResolvedValue(team);
});
afterEach(cleanup);

describe("the team's settings", () => {
  it("show the tournaments and the home venue and save the edited ones", async () => {
    render(<CreateTeamForm token="t" initial={team} onCreated={() => {}} onCancel={() => {}} />);

    expect((screen.getByLabelText(/Домашняя площадка/) as HTMLInputElement).value).toBe("Арена");
    fireEvent.change(screen.getByLabelText(/Турниры команды/), { target: { value: "Лига\n  Кубок города \n\n" } });
    fireEvent.change(screen.getByLabelText(/Домашняя площадка/), { target: { value: "Стадион" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(updateTeam).toHaveBeenCalled());
    expect(updateTeam).toHaveBeenCalledWith("t", "t1", expect.objectContaining({ tournaments: ["Лига", "Кубок города"], home_venue: "Стадион" }));
  });
});
