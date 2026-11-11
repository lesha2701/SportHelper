import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTeam, leaveTeam, listMembers } from "../../api/teams";
import type { Team, TeamMember, TeamRole } from "../../types/team";
import { TeamDetailScreen } from "./TeamDetailScreen";

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ state: { status: "ready", user: { id: "me" } } }) }));
vi.mock("../../hooks/useChatUnread", () => ({ useChatUnread: () => ({ unread: { booking: {}, team: {}, total: 0 }, refresh: () => {} }) }));
vi.mock("../../api/teams", () => ({
  getTeam: vi.fn(), listMembers: vi.fn(), listInvites: vi.fn(async () => []), createInvite: vi.fn(), leaveTeam: vi.fn(),
  listApplications: vi.fn(async () => []), acceptApplication: vi.fn(), rejectApplication: vi.fn(),
}));
vi.mock("../../api/stats", () => ({ getTeamStats: vi.fn(async () => { throw new Error("no stats"); }) }));
vi.mock("../../api/matches", () => ({ listTeamMatches: vi.fn(async () => []) }));
vi.mock("../../api/trainings", () => ({ listTeamTrainings: vi.fn(async () => []) }));
vi.mock("../../api/ai", () => ({ getTeamSummary: vi.fn() }));
vi.mock("../../components/shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => null }));

const team = (myRole: TeamRole): Team => ({
  id: "team1", name: "Ястребы", description: null, sport: "Футбол", ageCategory: null, level: null, status: "active",
  createdBy: "c1", logoFileId: null, tournaments: [], homeVenue: null, myRole, membersCount: 2,
});
const member = (userId: string, firstName: string, role: TeamRole): TeamMember => ({
  userId, firstName, lastName: null, username: null, photoUrl: null, role, position: null, joinedAt: "2026-01-01T00:00:00Z",
});

async function open(myRole: TeamRole, onBack = vi.fn()) {
  vi.mocked(getTeam).mockResolvedValue(team(myRole));
  vi.mocked(listMembers).mockResolvedValue([member("c1", "Анна", "head_coach"), member("p1", "Игорь", "player")]);
  render(<TeamDetailScreen token="t" teamId="team1" onBack={onBack} />);
  await act(async () => {});
  return onBack;
}

beforeEach(() => vi.mocked(leaveTeam).mockReset().mockResolvedValue(undefined));
afterEach(cleanup);

describe("an ordinary player can leave the team", () => {
  it("offers «Покинуть команду» under the roster, asks, leaves and goes back", async () => {
    const onBack = await open("player");
    fireEvent.click(screen.getByRole("button", { name: "Покинуть команду" }));
    expect(screen.getByText("Покинуть команду?")).toBeTruthy();
    expect(leaveTeam).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Покинуть" }));
    });
    expect(leaveTeam).toHaveBeenCalledWith("t", "team1");
    expect(onBack).toHaveBeenCalled();
  });

  it("stays in the team when the player cancels", async () => {
    const onBack = await open("player");
    fireEvent.click(screen.getByRole("button", { name: "Покинуть команду" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(leaveTeam).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("does not show a second button to a coach: theirs is in the settings", async () => {
    await open("head_coach");
    expect(screen.queryByRole("button", { name: "Покинуть команду" })).toBeNull();
  });
});
