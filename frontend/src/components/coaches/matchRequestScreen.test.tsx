import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptMatchOffer,
  cancelMatchRequest,
  createMatchRequest,
  declineMatchOffer,
  listMyMatchRequests,
  type MatchOffer,
  type MatchRequest,
} from "../../api/matchRequests";
import { ApiError } from "../../api/client";
import { MatchRequestScreen } from "./MatchRequestScreen";

vi.mock("../../api/matchRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/matchRequests")>()),
  createMatchRequest: vi.fn(),
  listMyMatchRequests: vi.fn(),
  cancelMatchRequest: vi.fn(),
  acceptMatchOffer: vi.fn(),
  declineMatchOffer: vi.fn(),
}));
const flush = () => act(async () => {});

const existing: MatchRequest = {
  id: "r1", sport: "Теннис", goal: "Поставить удар справа", level: "amateur", format: "offline", city: "Москва", budgetMin: 1500, budgetMax: 3000,
  currency: "RUB", weekdays: [1, 5], dayParts: ["evening"], scheduleNote: "после 19:00", comment: null, status: "new", createdAt: "2026-11-23T10:00:00Z", offers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMyMatchRequests).mockResolvedValue([]);
  vi.mocked(createMatchRequest).mockResolvedValue(existing);
});
afterEach(cleanup);

const typeSport = (value: string) => fireEvent.change(screen.getByPlaceholderText("Например: теннис"), { target: { value } });

describe("the «Подобрать тренера» form", () => {
  it("needs only the sport: nothing is sent without it, and the rest goes as empty", async () => {
    render(<MatchRequestScreen />);
    await flush();
    const send = screen.getByRole("button", { name: "Отправить заявку" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    typeSport("  Плавание ");
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await flush();

    expect(createMatchRequest).toHaveBeenCalledWith({
      sport: "Плавание", goal: null, level: null, format: null, city: null, budgetMin: null, budgetMax: null,
      weekdays: [], dayParts: [], scheduleNote: null, comment: null,
    });
  });

  it("sends everything the person chose", async () => {
    render(<MatchRequestScreen />);
    await flush();
    typeSport("Теннис");
    fireEvent.change(screen.getByPlaceholderText(/Цель: подача/), { target: { value: "Подача" } });
    fireEvent.click(screen.getByRole("button", { name: "Любитель" }));
    fireEvent.click(screen.getByRole("button", { name: "Очно" }));
    fireEvent.change(screen.getByPlaceholderText(/Где удобно/), { target: { value: " Москва " } });
    fireEvent.change(screen.getByLabelText("Бюджет от"), { target: { value: "1 500" } });
    fireEvent.change(screen.getByLabelText("Бюджет до"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Сб" }));
    fireEvent.click(screen.getByRole("button", { name: "Вт" }));
    fireEvent.click(screen.getByRole("button", { name: "Вечер" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    await flush();

    expect(createMatchRequest).toHaveBeenCalledWith({
      sport: "Теннис", goal: "Подача", level: "amateur", format: "offline", city: "Москва", budgetMin: 1500, budgetMax: 3000,
      weekdays: [1, 5], dayParts: ["evening"], scheduleNote: null, comment: null,
    });
  });

  it("lets a chosen option be taken back", async () => {
    render(<MatchRequestScreen />);
    await flush();
    const online = screen.getByRole("button", { name: "Онлайн" });
    fireEvent.click(online);
    expect(online.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(online);
    expect(online.getAttribute("aria-pressed")).toBe("false");
  });

  it("refuses a budget that is not numbers or whose «от» is above the «до»", async () => {
    render(<MatchRequestScreen />);
    await flush();
    typeSport("Теннис");
    const send = screen.getByRole("button", { name: "Отправить заявку" }) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText("Бюджет от"), { target: { value: "много" } });
    expect(screen.getByText("Бюджет: только цифры.")).toBeTruthy();
    expect(send.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Бюджет от"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Бюджет до"), { target: { value: "1000" } });
    expect(screen.getByText(/«от» не может быть больше/)).toBeTruthy();
    expect(send.disabled).toBe(true);
  });

  it("thanks the person and refreshes the list; a refusal of the server is shown", async () => {
    render(<MatchRequestScreen />);
    await flush();
    typeSport("Теннис");
    fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    await flush();
    expect(screen.getByText(/Спасибо! Заявка отправлена/)).toBeTruthy();
    expect(listMyMatchRequests).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Отправить ещё одну" }));
    vi.mocked(createMatchRequest).mockRejectedValue(new ApiError(409, "too_many_open", "У вас уже есть заявки на подбор."));
    typeSport("Бокс");
    fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    await flush();
    expect(screen.getByText("У вас уже есть заявки на подбор.")).toBeTruthy();
  });

  it("shows the person's requests with what they filled in, and withdraws an open one", async () => {
    vi.mocked(listMyMatchRequests).mockResolvedValue([existing, { ...existing, id: "r2", sport: "Бокс", goal: "Спарринги", budgetMin: null, budgetMax: null, weekdays: [], dayParts: [], scheduleNote: null, status: "closed" }]);
    vi.mocked(cancelMatchRequest).mockResolvedValue({ ...existing, status: "canceled" });
    render(<MatchRequestScreen />);
    await flush();

    expect(screen.getByText("Поставить удар справа")).toBeTruthy();
    expect(screen.getByText("от 1 500 до 3 000 ₽")).toBeTruthy();
    expect(screen.getByText("Вт, Сб · вечер · после 19:00")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Отозвать заявку" })).toHaveLength(1); // the closed one cannot be withdrawn

    fireEvent.click(screen.getByRole("button", { name: "Отозвать заявку" }));
    await flush();
    expect(cancelMatchRequest).toHaveBeenCalledWith("r1");
    expect(screen.getByText("Отозвана")).toBeTruthy();
  });

  it("asks a guest to sign in instead of showing the form", async () => {
    const onRequireLogin = vi.fn();
    render(<MatchRequestScreen guest onRequireLogin={onRequireLogin} />);
    await flush();

    expect(screen.queryByPlaceholderText("Например: теннис")).toBeNull();
    expect(listMyMatchRequests).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(onRequireLogin).toHaveBeenCalled();
  });
});

const offer: MatchOffer = {
  id: "o1", status: "coach_accepted", expiresAt: "2026-11-27T10:00:00Z",
  coach: { userId: "c1", fullName: "Иван Тренеров", isPro: true, photoUrl: null, sport: "Теннис", specialization: "Подача", experienceYears: 8, averageRating: 4.9, reviewCount: 14 },
  listings: [{ id: "l1", title: "Теннис для взрослых", pricePerSession: 2500, currency: "RUB" }],
};

describe("the trainers who agreed", () => {
  it("shows the trainer's card and lets the person choose or decline", async () => {
    vi.mocked(listMyMatchRequests).mockResolvedValue([{ ...existing, status: "in_progress", offers: [offer] }]);
    vi.mocked(acceptMatchOffer).mockResolvedValue({ ...existing, status: "matched", offers: [{ ...offer, status: "athlete_accepted", expiresAt: null }] });
    const onOpenCoach = vi.fn();
    render(<MatchRequestScreen onOpenCoach={onOpenCoach} />);
    await flush();

    expect(screen.getByText("Иван Тренеров")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText(/стаж 8 лет · ★ 4.9 \(14\)/)).toBeTruthy();
    expect(screen.getByText(/Теннис для взрослых — 2\s?500 ₽/)).toBeTruthy();
    expect(screen.getByText(/из тренеров, участвующих в подборе/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Профиль тренера" }));
    expect(onOpenCoach).toHaveBeenCalledWith("c1");

    fireEvent.click(screen.getByRole("button", { name: "Выбрать этого тренера" }));
    await flush();
    expect(acceptMatchOffer).toHaveBeenCalledWith("o1");
    expect(screen.getByText("Ваш тренер")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Записаться на тренировку" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Выбрать этого тренера" })).toBeNull();
  });

  it("declines a trainer: the card goes away and the request keeps being worked on", async () => {
    vi.mocked(listMyMatchRequests).mockResolvedValue([{ ...existing, status: "in_progress", offers: [offer] }]);
    vi.mocked(declineMatchOffer).mockResolvedValue({ ...existing, status: "in_progress", offers: [] });
    render(<MatchRequestScreen />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Не подходит" }));
    await flush();

    expect(declineMatchOffer).toHaveBeenCalledWith("o1");
    expect(screen.queryByText("Иван Тренеров")).toBeNull();
    expect(screen.getByText("Подбираем тренера")).toBeTruthy();
  });

  it("shows the server's refusal (the time ran out) and reloads", async () => {
    vi.mocked(listMyMatchRequests).mockResolvedValue([{ ...existing, status: "in_progress", offers: [offer] }]);
    vi.mocked(acceptMatchOffer).mockRejectedValue(new ApiError(409, "offer_closed", "Время выбора вышло."));
    render(<MatchRequestScreen />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать этого тренера" }));
    await flush();

    expect(screen.getByText("Время выбора вышло.")).toBeTruthy();
    expect(listMyMatchRequests).toHaveBeenCalledTimes(2);
  });
});
