import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptApplication, createInvite, getTeam, listApplications, listInvites, listMembers, rejectApplication } from "../../api/teams";
import type { Invite, JoinRequest, Team, TeamMember, TeamRole } from "../../types/team";
import { TeamDetailScreen } from "./TeamDetailScreen";

vi.mock("../../api/teams", () => ({
  getTeam: vi.fn(), listMembers: vi.fn(), listInvites: vi.fn(), createInvite: vi.fn(), leaveTeam: vi.fn(),
  listApplications: vi.fn(async () => []), acceptApplication: vi.fn(), rejectApplication: vi.fn(),
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

const request = (id: string, firstName: string): JoinRequest => ({
  id, teamId: "team1", userId: `u-${id}`, firstName, lastName: null, username: null, photoUrl: null,
  status: "pending", createdAt: "2026-10-10T00:00:00Z",
});

beforeEach(() => {
  vi.mocked(listApplications).mockReset().mockResolvedValue([]);
  vi.mocked(acceptApplication).mockReset();
  vi.mocked(rejectApplication).mockReset();
  vi.mocked(createInvite).mockReset();
  vi.mocked(listInvites).mockReset();
});
afterEach(cleanup);

const expand = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Пригласительная ссылка/ }));
  await act(async () => {});
};

describe("inviting players from the roster", () => {
  it("shows only the title above the members until it is pressed", async () => {
    await open("head_coach");

    const heading = screen.getByText("Пригласительная ссылка");
    const firstMember = screen.getByText(/Игорь/);
    expect(heading.compareDocumentPosition(firstMember) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Создать новую ссылку" })).toBeNull();
    expect(screen.queryByText("https://example.com/?invite=tok")).toBeNull();
    expect(listInvites).not.toHaveBeenCalled(); // nothing is fetched for a section nobody opened
  });

  it("expands on a press and collapses again on the next", async () => {
    await open("head_coach");

    await expand();
    expect(screen.getByRole("button", { name: /Пригласительная ссылка/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("https://example.com/?invite=tok")).not.toBeNull();

    await expand();
    expect(screen.queryByRole("button", { name: "Создать новую ссылку" })).toBeNull();
  });

  it("generates a new link once expanded", async () => {
    await open("head_coach");
    await expand();
    vi.mocked(createInvite).mockResolvedValue({ ...invite, id: "i2", token: "tok2", link: "https://example.com/?invite=tok2" });

    fireEvent.click(screen.getByRole("button", { name: "Создать новую ссылку" }));
    await act(async () => {});

    expect(createInvite).toHaveBeenCalledWith("t", "team1", "join");
    expect(screen.getByText("https://example.com/?invite=tok2")).not.toBeNull();
  });

  it("is no longer in the settings tab", async () => {
    await open("head_coach");

    fireEvent.click(screen.getByRole("button", { name: "Настройки" }));

    expect(screen.queryByText("Пригласительная ссылка")).toBeNull();
    expect(screen.queryByRole("button", { name: "Создать новую ссылку" })).toBeNull();
  });

  it("isn't shown to a player", async () => {
    await open("player");

    expect(screen.queryByText("Пригласительная ссылка")).toBeNull();
    expect(screen.getByText(/Игорь/)).not.toBeNull();
  });

  describe("join requests", () => {
    it("shows the number of pending requests on the collapsed header, without opening it", async () => {
      vi.mocked(listApplications).mockResolvedValue([request("r1", "Олег"), request("r2", "Мария")]);
      await open("head_coach");

      const header = screen.getByRole("button", { name: /Пригласительная ссылка/ });
      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByLabelText("Новых заявок: 2").textContent).toBe("2");
      expect(screen.queryByText(/Олег/)).toBeNull();
    });

    it("shows no counter when there are no requests", async () => {
      await open("head_coach");
      expect(screen.queryByLabelText(/Новых заявок/)).toBeNull();
    });

    it("lists the requests inside the opened panel and accepts one without collapsing it", async () => {
      vi.mocked(listApplications).mockResolvedValue([request("r1", "Олег"), request("r2", "Мария")]);
      vi.mocked(acceptApplication).mockResolvedValue(undefined);
      await open("head_coach");
      await expand();

      expect(screen.getByText(/Олег/)).not.toBeNull();
      fireEvent.click(screen.getAllByRole("button", { name: "Принять" })[0]!);
      await act(async () => {});

      expect(acceptApplication).toHaveBeenCalledWith("t", "team1", "r1");
      expect(screen.queryByText(/Олег/)).toBeNull();
      expect(screen.getByLabelText("Новых заявок: 1")).not.toBeNull();
      expect(screen.getByRole("button", { name: /Пригласительная ссылка/ }).getAttribute("aria-expanded")).toBe("true");
    });

    it("rejects a request", async () => {
      vi.mocked(listApplications).mockResolvedValue([request("r1", "Олег")]);
      vi.mocked(rejectApplication).mockResolvedValue(undefined);
      await open("head_coach");
      await expand();

      fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));
      await act(async () => {});

      expect(rejectApplication).toHaveBeenCalledWith("t", "team1", "r1");
      expect(screen.getByText("Новых заявок нет.")).not.toBeNull();
    });

    it("is not requested for a player and is gone from the settings tab", async () => {
      await open("player");
      expect(listApplications).not.toHaveBeenCalled();

      cleanup();
      await open("head_coach");
      fireEvent.click(screen.getByRole("button", { name: "Настройки" }));
      expect(screen.queryByRole("heading", { name: /Заявки/ })).toBeNull();
    });
  });
});
