import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvite, getTeam, listInvites, listMembers } from "../../api/teams";
import type { Invite, Team, TeamMember, TeamRole } from "../../types/team";
import { TeamDetailScreen } from "./TeamDetailScreen";

vi.mock("../../api/teams", () => ({
  getTeam: vi.fn(), listMembers: vi.fn(), listInvites: vi.fn(), createInvite: vi.fn(), leaveTeam: vi.fn(),
  listApplications: vi.fn(async () => []),
}));
vi.mock("../../api/stats", () => ({ getTeamStats: vi.fn(async () => { throw new Error("no stats"); }) }));
vi.mock("../../api/matches", () => ({ listTeamMatches: vi.fn(async () => []) }));
vi.mock("../../api/trainings", () => ({ listTeamTrainings: vi.fn(async () => []) }));
vi.mock("../../api/ai", () => ({ getTeamSummary: vi.fn() }));
vi.mock("../../components/shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => null }));

const team = (myRole: TeamRole): Team => ({
  id: "team1", name: "Ястребы", description: null, sport: "Футбол", ageCategory: null, level: null, status: "active",
  createdBy: "c1", logoFileId: null, myRole, membersCount: 2,
});
const member = (userId: string, firstName: string, role: TeamRole): TeamMember => ({
  userId, firstName, lastName: null, username: null, photoUrl: null, role, position: null, joinedAt: "2026-01-01T00:00:00Z",
});
const invite: Invite = {
  id: "i1", teamId: "team1", token: "tok", kind: "join", link: "https://example.com/?invite=tok",
  expiresAt: "2026-12-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z",
};

async function open(myRole: TeamRole) {
  vi.mocked(getTeam).mockResolvedValue(team(myRole));
  vi.mocked(listMembers).mockResolvedValue([member("c1", "Анна", "head_coach"), member("p1", "Игорь", "player")]);
  vi.mocked(listInvites).mockResolvedValue([invite]);
  render(<TeamDetailScreen token="t" teamId="team1" onBack={vi.fn()} />);
  await act(async () => {});
}

beforeEach(() => vi.mocked(createInvite).mockReset());
afterEach(cleanup);

describe("inviting players from the roster", () => {
  it("puts the invite link on the roster tab, above the members, for the coach", async () => {
    await open("head_coach");

    const heading = screen.getByText("Пригласить игроков");
    const firstMember = screen.getByText(/Игорь/);
    expect(heading.compareDocumentPosition(firstMember) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("https://example.com/?invite=tok")).not.toBeNull();
  });

  it("generates a new link right there", async () => {
    await open("head_coach");
    vi.mocked(createInvite).mockResolvedValue({ ...invite, id: "i2", token: "tok2", link: "https://example.com/?invite=tok2" });

    fireEvent.click(screen.getByRole("button", { name: "Создать новую ссылку" }));
    await act(async () => {});

    expect(createInvite).toHaveBeenCalledWith("t", "team1", "join");
    expect(screen.getByText("https://example.com/?invite=tok2")).not.toBeNull();
  });

  it("is no longer in the settings tab", async () => {
    await open("head_coach");

    fireEvent.click(screen.getByRole("button", { name: "Настройки" }));

    expect(screen.queryByText("Пригласить игроков")).toBeNull();
    expect(screen.queryByRole("button", { name: "Создать новую ссылку" })).toBeNull();
  });

  it("isn't shown to a player", async () => {
    await open("player");

    expect(screen.queryByText("Пригласить игроков")).toBeNull();
    expect(screen.getByText(/Игорь/)).not.toBeNull();
  });
});
