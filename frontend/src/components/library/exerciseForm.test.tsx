import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, updateExercise, uploadExercisePhoto, uploadExerciseVideo } from "../../api/exercises";
import { ApiError } from "../../api/client";
import type { Exercise } from "../../types/exercise";
import { ExerciseForm } from "./ExerciseForm";

vi.mock("../../api/exercises", () => ({
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  uploadExercisePhoto: vi.fn(),
  uploadExerciseVideo: vi.fn(),
}));
vi.mock("../shared/pendingMedia", () => ({ checkVideo: vi.fn(async () => null), usePreviewUrl: () => null }));

const saved = { id: "e1", name: "Присед", sport: "Футбол" } as Exercise;
const onSaved = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createExercise).mockResolvedValue(saved);
  vi.mocked(updateExercise).mockResolvedValue(saved);
  vi.mocked(uploadExercisePhoto).mockResolvedValue({ ...saved, photoFileId: "p1" });
  vi.mocked(uploadExerciseVideo).mockResolvedValue({ ...saved, videoFileId: "v1" });
});
afterEach(cleanup);

const fill = () => {
  fireEvent.change(screen.getByRole("combobox", { name: /Вид спорта/ }), { target: { value: "Футбол" } });
  fireEvent.change(screen.getByLabelText(/Название/), { target: { value: "Присед" } });
};
const pick = (label: string, file: File) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Создать упражнение" }));

describe("creating an exercise", () => {
  it("puts the «Дополнительные поля» toggle before the photo and video pickers", () => {
    render(<ExerciseForm token="t" onSaved={onSaved} onCancel={() => {}} />);

    const toggle = screen.getByRole("button", { name: "Дополнительные поля" });
    const photo = screen.getByLabelText("Добавить фотографию");
    expect(toggle.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lets the coach pick a photo and a video before anything is saved", () => {
    render(<ExerciseForm token="t" onSaved={onSaved} onCancel={() => {}} />);

    expect(screen.getByLabelText("Добавить фотографию")).toBeTruthy();
    expect(screen.getByLabelText("Добавить видео")).toBeTruthy();
  });

  it("shows only the essentials at first and the rest behind «Дополнительные поля»", () => {
    render(<ExerciseForm token="t" onSaved={onSaved} onCancel={() => {}} />);

    for (const shown of [/Вид спорта/, /Название/, /Описание/]) expect(screen.getAllByText(shown).length).toBeGreaterThan(0);
    for (const hidden of ["Цель", "Подходы", "Повторения", "Инвентарь", "Сложность", "Техника выполнения", "Типичные ошибки", "Предупреждения", "Комментарий тренера"]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }

    fireEvent.click(screen.getByRole("button", { name: "Дополнительные поля" }));

    for (const shown of ["Цель", "Подходы", "Повторения", "Инвентарь", "Сложность", "Техника выполнения", "Типичные ошибки", "Предупреждения", "Комментарий тренера"]) {
      expect(screen.getByText(shown)).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Дополнительные поля" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("saves the exercise and then uploads the picked photo and video in one go", async () => {
    render(<ExerciseForm token="t" onSaved={onSaved} onCancel={() => {}} />);
    fill();
    const photo = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const video = new File(["y"], "b.mp4", { type: "video/mp4" });
    pick("Добавить фотографию", photo);
    pick("Добавить видео", video);
    await waitFor(() => expect(screen.getByLabelText("b.mp4")).toBeTruthy());

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createExercise).toHaveBeenCalledTimes(1);
    expect(uploadExercisePhoto).toHaveBeenCalledWith("t", "e1", photo);
    expect(uploadExerciseVideo).toHaveBeenCalledWith("t", "e1", video);
  });

  it("needs no files at all", async () => {
    render(<ExerciseForm token="t" onSaved={onSaved} onCancel={() => {}} />);
    fill();

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(uploadExercisePhoto).not.toHaveBeenCalled();
    expect(uploadExerciseVideo).not.toHaveBeenCalled();
  });

  it("if the upload fails, keeps the form, says what happened, and a second try does not create a duplicate", async () => {
    vi.mocked(uploadExercisePhoto).mockRejectedValueOnce(new ApiError(415, "unsupported_media_type", "Неподдерживаемый формат файла."));
    render(<ExerciseForm token="t" onSaved={onSaved} onCancel={() => {}} />);
    fill();
    pick("Добавить фотографию", new File(["x"], "a.jpg", { type: "image/jpeg" }));

    save();

    expect(await screen.findByText(/Упражнение сохранено, но не удалось загрузить фото: Неподдерживаемый формат файла/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Создать упражнение" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createExercise).toHaveBeenCalledTimes(1);
    expect(updateExercise).toHaveBeenCalledTimes(1);
    expect(uploadExercisePhoto).toHaveBeenCalledTimes(2);
  });
});

describe("editing an exercise", () => {
  it("opens with the extra fields visible, so values already set are never hidden", () => {
    render(<ExerciseForm token="t" initial={{ ...saved, goal: "Сила ног" } as Exercise} onSaved={onSaved} onCancel={() => {}} />);

    expect(screen.getByDisplayValue("Сила ног")).toBeTruthy();
    expect(screen.getByLabelText("Добавить фотографию")).toBeTruthy();
  });
});
