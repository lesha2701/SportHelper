import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamTasksTab } from "./TeamTasksTab";

vi.mock("../../api/tasks", () => ({ listTeamTasks: vi.fn(async () => []) }));
vi.mock("../../api/taskTemplates", () => ({ listMyTemplates: vi.fn(async () => []) }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ state: { status: "ready", user: { id: "u1" } } }) }));

afterEach(cleanup);

describe("the tasks of a team", () => {
  it("puts «Добавить задание из библиотеки» first for a coach", async () => {
    render(<TeamTasksTab token="t" teamId="team" canManage />);
    const library = await screen.findByRole("button", { name: /Добавить задание из библиотеки/ });
    const fresh = screen.getByRole("button", { name: /Новое задание/ });
    expect(library.compareDocumentPosition(fresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a player no buttons to add anything", async () => {
    render(<TeamTasksTab token="t" teamId="team" canManage={false} />);
    await screen.findByText("Пока нет заданий");
    expect(screen.queryByRole("button", { name: /Добавить задание/ })).toBeNull();
  });
});
