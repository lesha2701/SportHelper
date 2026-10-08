import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTask, reviewTask } from "../../api/tasks";
import type { Task, TaskAssignment } from "../../types/task";
import { TaskDetail } from "./TaskDetail";

vi.mock("../../api/tasks", () => ({
  getTask: vi.fn(),
  reviewTask: vi.fn(),
  deleteTask: vi.fn(),
  startTask: vi.fn(),
  submitTask: vi.fn(),
  uploadTaskPhoto: vi.fn(),
  uploadTaskVideo: vi.fn(),
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ state: { status: "ready", user: { id: "coach-1" }, token: "t" } }),
}));

const assignment = (userId: string, firstName: string, status: TaskAssignment["status"]): TaskAssignment => ({
  id: `as-${userId}`,
  taskId: "task-1",
  userId,
  telegramId: 1,
  firstName,
  lastName: null,
  photoUrl: null,
  position: null,
  status,
  comment: "Сделал",
  photoFileId: null,
  videoFileId: null,
  sets: null,
  reps: null,
  durationMinutes: null,
  metricValue: null,
  difficulty: null,
  wellbeing: null,
  coachComment: null,
  reviewedBy: null,
  reviewedAt: null,
  viewedAt: null,
  submittedAt: "2026-10-06T10:00:00Z",
});

const task = (assignments: TaskAssignment[]): Task => ({
  id: "task-1",
  teamId: "team-1",
  createdBy: "coach-1",
  title: "100 передач",
  description: null,
  planId: null,
  deadline: null,
  metricName: null,
  metricUnit: null,
  metricTarget: null,
  requireComment: false,
  requirePhoto: false,
  requireVideo: false,
  requireSetsReps: false,
  requireDuration: false,
  requireMetricValue: false,
  requireDifficulty: false,
  requireWellbeing: false,
  targetType: "team",
  targetPosition: null,
  targetTrainingId: null,
  exercises: [],
  assignments,
});

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const flush = () => act(async () => {});

async function reviewFirst(task_: Task, onBack = vi.fn()) {
  vi.mocked(getTask).mockResolvedValue(task_);
  vi.mocked(reviewTask).mockResolvedValue(task_.assignments[0]!);
  render(<TaskDetail token="t" taskId="task-1" canManage onBack={onBack} onEdit={() => {}} onDeleted={() => {}} />);
  await flush();
  fireEvent.click(screen.getByText(/Анна/)); // expand the first report
  click("Принять");
  await flush();
  return onBack;
}

beforeEach(() => {
  vi.mocked(getTask).mockReset();
  vi.mocked(reviewTask).mockReset();
});
afterEach(cleanup);

describe("coach reviewing task reports", () => {
  it("says how many reports wait for a decision", async () => {
    vi.mocked(getTask).mockResolvedValue(task([assignment("u1", "Анна", "submitted"), assignment("u2", "Борис", "submitted")]));
    render(<TaskDetail token="t" taskId="task-1" canManage onBack={() => {}} onEdit={() => {}} onDeleted={() => {}} />);
    await flush();

    expect(screen.getByText(/ждут проверки: 2/)).not.toBeNull();
  });

  it("offers the next waiting report after a decision", async () => {
    await reviewFirst(task([assignment("u1", "Анна", "submitted"), assignment("u2", "Борис", "submitted")]));

    expect(screen.getByText("Отчёт принят")).not.toBeNull();
    click("Следующий отчёт");
    expect(screen.queryByText("Отчёт принят")).toBeNull();
    expect(screen.getByRole("button", { name: "Вернуть на доработку" })).not.toBeNull(); // Борис's report is now open
  });

  it("when nothing else is waiting, goes back to the task or to the task list", async () => {
    const onBack = await reviewFirst(task([assignment("u1", "Анна", "submitted"), assignment("u2", "Борис", "accepted")]));

    expect(screen.getByText(/Все отправленные отчёты проверены/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Следующий отчёт" })).toBeNull();
    click("К списку заданий");
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
