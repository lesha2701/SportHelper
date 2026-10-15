import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTraining, getTrainingFeedback, skipTrainingFeedback, submitTrainingFeedback, updateTraining } from "../../api/trainings";
import { getTrainingEvaluation } from "../../api/ai";
import type { Training, TrainingFeedback } from "../../types/training";
import { TrainingDetail } from "./TrainingDetail";

vi.mock("../../api/trainings", () => ({
  cancelTrainingSeries: vi.fn(),
  getTraining: vi.fn(),
  getTrainingFeedback: vi.fn(),
  skipTrainingFeedback: vi.fn(),
  submitTrainingFeedback: vi.fn(),
  updateTraining: vi.fn(),
}));
vi.mock("../../api/plans", () => ({ getPlan: vi.fn() }));
vi.mock("../../api/ai", () => ({ getTrainingEvaluation: vi.fn() }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ state: { status: "ready", user: { id: "me" } } }) }));

const getTrainingMock = vi.mocked(getTraining);
const getFeedbackMock = vi.mocked(getTrainingFeedback);
const submitMock = vi.mocked(submitTrainingFeedback);
const skipMock = vi.mocked(skipTrainingFeedback);
const updateMock = vi.mocked(updateTraining);
const evaluationMock = vi.mocked(getTrainingEvaluation);

const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function makeTraining(overrides: Partial<Training> = {}): Training {
  return {
    id: "t1", teamId: "team1", createdBy: "me", type: "team", planId: null, trainingDate: IN_A_WEEK, startTime: "18:00:00",
    durationMinutes: 90, location: null, description: null, status: "scheduled", reminderMinutesBefore: null,
    recurrenceGroupId: null, responsibleUserId: null, ...overrides,
  };
}

function makeFeedback(overrides: Partial<TrainingFeedback> = {}): TrainingFeedback {
  return { trainingId: "t1", userId: "me", wellbeing: null, difficulty: null, comment: null, teamRating: null, skipped: false, ...overrides };
}

async function open(training: Training, canEdit: boolean) {
  getTrainingMock.mockResolvedValue(training);
  render(<TrainingDetail token="t" trainingId={training.id} canEdit={canEdit} onBack={vi.fn()} onEdit={vi.fn()} />);
  await act(async () => {});
}

beforeEach(() => {
  [getTrainingMock, getFeedbackMock, submitMock, skipMock, updateMock, evaluationMock].forEach((m) => m.mockReset());
  getFeedbackMock.mockResolvedValue(null);
});
afterEach(cleanup);

describe("attendance on a team training", () => {
  it("isn't offered before the training took place", async () => {
    await open(makeTraining(), true);

    expect(screen.queryByRole("button", { name: "Отметить посещаемость" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Посещаемость" })).toBeNull();
    expect(screen.getByRole("button", { name: "Отметить проведённой" })).not.toBeNull();
  });

  it("appears for the coach right after they press «Отметить проведённой»", async () => {
    await open(makeTraining(), true);
    updateMock.mockResolvedValue(undefined as never);
    getTrainingMock.mockResolvedValue(makeTraining({ status: "completed" }));

    fireEvent.click(screen.getByRole("button", { name: "Отметить проведённой" }));
    await act(async () => {});

    expect(updateMock).toHaveBeenCalledWith("t", "t1", expect.objectContaining({ status: "completed" }));
    expect(screen.getByRole("button", { name: "Отметить посещаемость" })).not.toBeNull();
  });

  it("is available (read-only) to a player once the training is marked as held", async () => {
    await open(makeTraining({ status: "completed" }), false);

    expect(screen.getByRole("button", { name: "Посещаемость" })).not.toBeNull();
  });

  it("is offered for a past training nobody marked yet", async () => {
    await open(makeTraining({ trainingDate: YESTERDAY }), true);

    expect(screen.getByRole("button", { name: "Отметить посещаемость" })).not.toBeNull();
  });
});

describe("after a team training is marked as held", () => {
  it("asks the coach to rate the team - not their own wellbeing - and never calls the AI", async () => {
    await open(makeTraining({ status: "completed" }), true);

    expect(screen.getByText("Как команда провела тренировку?")).not.toBeNull();
    expect(screen.getByText(/Общая оценка команды/)).not.toBeNull();
    expect(screen.queryByText(/Самочувствие/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "4" }));
    submitMock.mockResolvedValue(makeFeedback({ teamRating: 4, comment: "Хорошо" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить оценку" }));
    await act(async () => {});

    expect(submitMock).toHaveBeenCalledWith("t", "t1", { team_rating: 4, difficulty: null, comment: null });
    expect(evaluationMock).not.toHaveBeenCalled();
    expect(screen.getByText("Оценка команды")).not.toBeNull();
    expect(screen.getByText("4 / 5")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Оценить тренировку" })).toBeNull();
  });

  it("needs a rating before it can be saved", async () => {
    await open(makeTraining({ status: "completed" }), true);

    expect((screen.getByRole("button", { name: "Сохранить оценку" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the coach skip, and change their mind later", async () => {
    await open(makeTraining({ status: "completed" }), true);
    skipMock.mockResolvedValue(makeFeedback({ skipped: true }));

    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }));
    await act(async () => {});

    expect(screen.getByText("Вы не оценивали эту тренировку.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Оценить команду" }));
    expect(screen.getByText("Как команда провела тренировку?")).not.toBeNull();
  });

  it("keeps the player's own prompt: wellbeing, then the AI evaluation", async () => {
    await open(makeTraining({ status: "completed" }), false);

    expect(screen.getByText("Как прошла тренировка?")).not.toBeNull();
    expect(screen.getByText(/Самочувствие/)).not.toBeNull();
    expect(screen.queryByText(/Общая оценка команды/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "5" }));
    submitMock.mockResolvedValue(makeFeedback({ wellbeing: 5 }));
    evaluationMock.mockResolvedValue("Отлично поработали");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить и оценить" }));
    await act(async () => {});

    expect(submitMock).toHaveBeenCalledWith("t", "t1", { wellbeing: 5, difficulty: null, comment: null });
    expect(evaluationMock).toHaveBeenCalled();
    expect(screen.getByText("Отлично поработали")).not.toBeNull();
  });

  it("shows nothing about ratings before the training is marked as held", async () => {
    await open(makeTraining(), true);

    expect(screen.queryByText("Как команда провела тренировку?")).toBeNull();
    expect(screen.queryByText("Как прошла тренировка?")).toBeNull();
  });
});
